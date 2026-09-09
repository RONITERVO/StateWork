import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemoryStore,
  WorkService,
  blankPacket,
  packetContext,
  packetCompleteCommand,
  packetIssues,
  validateState,
  parse,
  workerHandoffSchema,
  reconcilePacketProposal,
  packetInputSchema,
} from '@statework/sdk';
import type { Command, PacketInput, WorkspaceStore } from '@statework/sdk';
import { SqliteStore } from '@statework/node';

function fixture(store: WorkspaceStore = new MemoryStore()) {
  const service = new WorkService(store, () => '2026-09-09T12:00:00.000Z');
  const c = service.connect('worker');
  c.create({ id: 'work', title: 'Workshop' });
  let serial = 0;
  const run = (commands: Command[]) =>
    c.execute('work', {
      schemaVersion: 1,
      requestId: `request-${++serial}`,
      expectedRevision: c.snapshot('work').workspace.revision,
      commands,
    });
  run([{ type: 'item.create', item: { id: 'kit', kind: 'task', title: 'Make kit' } }]);
  const procedure =
    'Cut a 20 mm square. Label the box KIT. Compare the square with the drawing. If it differs, correct it and measure again. Send the approved result to the customer portal.';
  run([
    {
      type: 'source.capture',
      source: {
        id: 'spec',
        title: 'Workshop procedure',
        taskIds: ['kit'],
        locator: 'Author: test workshop',
        kind: 'note',
        coverage: 'complete',
        content: procedure,
        replaces: null,
      },
    },
  ]);
  const p = blankPacket(c.snapshot('work'), 'kit', 'packet');
  p.contextKey = packetContext(c.snapshot('work'), 'kit').procedureKey!;
  p.outcome = 'Verified kit delivered.';
  p.finish = 'Keep the delivery receipt and measured dimensions.';
  p.execution = {
    version: 1,
    completion: { anyOf: ['deliver'] },
    coverage: {
      inputs: 'checked',
      procedure: 'checked',
      acceptance: 'checked',
      note: 'Original dimensions, branching check and delivery requirements inspected.',
    },
    outputs: [],
  };
  p.requirements = [
    {
      id: 'portal',
      kind: 'account',
      itemId: null,
      label: 'Customer portal',
      detail: 'Open the customer portal.',
      check: 'Account can access the delivery form.',
      confirmed: false,
      url: 'https://example.com/delivery',
      citations: [],
    },
  ];
  const step = (id: string, after: string[]): PacketInput['steps'][number] => ({
    id,
    title: id,
    instruction: procedure,
    expected: 'Compare with the quoted specification.',
    ifBlocked: 'Stop and inspect the source.',
    minutes: 2,
    actionUrl: '',
    requires: [],
    citations: [{ sourceId: 'spec', quote: procedure, location: 'Procedure' }],
    after,
  });
  p.steps = [
    step('cut', []),
    step('label', []),
    {
      ...step('inspect', ['cut', 'label']),
      decision: {
        prompt: 'Does the square match?',
        options: [
          { id: 'yes', label: 'Matches' },
          { id: 'no', label: 'Correct it' },
        ],
      },
    },
    { ...step('repair', ['inspect']), when: { stepId: 'inspect', optionId: 'no' } },
    {
      ...step('deliver', ['inspect', 'repair']),
      phase: 'deliver',
      requires: ['portal'],
      evidenceRequired: true,
    },
  ];
  const save = () =>
    run([
      { type: 'packet.save', packet: p, expectedPacketId: null },
      { type: 'packet.review', id: p.id },
    ]);
  const check = (stepId: string, extra: object = {}) =>
    run([
      {
        type: 'packet.check',
        id: p.id,
        stepId,
        checked: true,
        evidence: 'Observed result',
        ...extra,
      },
    ]);
  return { store, service, c, p, run, save, check };
}

describe('connected worker execution', () => {
  it('includes explicitly referenced shared inputs even when their owner task is outside the context graph', async () => {
    const s = fixture();
    s.run([
      { type: 'item.create', item: { id: 'library', title: 'Shared standards', kind: 'note' } },
    ]);
    await s.c.attach(
      'work',
      {
        requestId: 'library-file',
        expectedRevision: s.c.snapshot('work').workspace.revision,
        asset: {
          id: 'shared',
          taskIds: ['library'],
          name: 'standard.txt',
          mediaType: 'text/plain',
          description: 'Shared original',
          locator: 'Fictional shared standard',
          replaces: null,
        },
      },
      new TextEncoder().encode('Shared geometry.'),
    );
    s.run([
      {
        type: 'source.capture',
        source: {
          id: 'shared-text',
          taskIds: ['library'],
          title: 'Shared text',
          content: 'Shared geometry.',
          locator: 'Fictional shared standard',
          kind: 'file',
          coverage: 'complete',
          replaces: null,
          assetId: 'shared',
        },
      },
    ]);
    s.p.sourceIds.push('shared-text');
    s.p.steps[0]!.references = [
      {
        id: 'shared-ref',
        kind: 'asset',
        targetId: 'shared',
        label: 'Shared drawing',
        location: 'Complete file',
        url: '',
        page: null,
        seconds: null,
        essential: true,
        purpose: 'input',
      },
    ];
    s.save();
    const handoff = s.c.handoff('work', 'kit');
    expect(handoff.assets.map((a) => a.id)).toContain('shared');
    expect(handoff.sources.map((a) => a.id)).toContain('shared-text');
    expect(handoff.assets.find((a) => a.id === 'shared')?.available).toBe(true);
    s.service.close();
  });
  it('rejects imported results that precede prerequisites or belong to an inactive branch', () => {
    const s = fixture();
    s.save();
    s.check('cut');
    s.check('label');
    s.check('inspect', { choice: 'yes' });
    const reversed = s.c.snapshot('work');
    reversed.instructions!.packets[0]!.checks.reverse();
    expect(() => validateState(reversed)).toThrow('instruction order');
    const inactive = s.c.snapshot('work');
    inactive.instructions!.packets[0]!.checks.push({
      stepId: 'repair',
      at: '2026-09-09T12:00:00.000Z',
      by: 'worker',
      evidence: 'Forged inactive branch',
    });
    expect(() => validateState(inactive)).toThrow('branch decisions');
    s.service.close();
  });
  it('records a stopped branch without allowing it to masquerade as successful completion', () => {
    const s = fixture();
    s.p.steps.find((s) => s.id === 'repair')!.title = 'Stop and request help';
    s.p.steps.find((s) => s.id === 'deliver')!.when = { stepId: 'inspect', optionId: 'yes' };
    s.save();
    s.check('cut');
    s.check('label');
    s.check('inspect', { choice: 'no' });
    s.check('repair');
    expect(s.c.handoff('work', 'kit').completion.outcome).toBe('stopped');
    expect(s.c.handoff('work', 'kit').blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: 'completion' })]),
    );
    expect(() => s.run([packetCompleteCommand(s.c.snapshot('work'), s.p.id)])).toThrow(
      'Review and check',
    );
    s.run([{ type: 'packet.check', id: s.p.id, stepId: 'inspect', checked: false, evidence: '' }]);
    s.check('inspect', { choice: 'yes' });
    s.run([
      {
        type: 'packet.confirm',
        id: s.p.id,
        requirementId: 'portal',
        available: true,
        evidence: 'Access checked',
      },
    ]);
    s.check('deliver');
    s.run([packetCompleteCommand(s.c.snapshot('work'), s.p.id)]);
    expect(s.c.handoff('work', 'kit').completion.outcome).toBe('successful');
    s.service.close();
  });
  it('lets independent production proceed, records a branch, and blocks only delivery access', () => {
    const s = fixture();
    s.save();
    expect(s.c.handoff('work', 'kit').next.map((s) => s.stepId)).toEqual(['cut', 'label']);
    expect(parse(workerHandoffSchema, s.c.handoff('work', 'kit')).format).toBe('statework.handoff');
    s.check('label');
    expect(() => s.check('inspect', { choice: 'yes' })).toThrow('prerequisites');
    s.check('cut');
    s.check('inspect', { choice: 'yes' });
    const graph = s.c.handoff('work', 'kit').graph;
    expect(graph.find((s) => s.id === 'repair')?.status).toBe('skipped');
    expect(graph.find((s) => s.id === 'deliver')?.blockers[0]?.target).toBe('portal');
    expect(() => s.check('deliver')).toThrow('prerequisites');
    s.run([
      {
        type: 'packet.confirm',
        id: s.p.id,
        requirementId: 'portal',
        available: true,
        evidence: 'Delivery form opened using my account.',
      },
    ]);
    expect(() => s.check('deliver', { evidence: '' })).toThrow('evidence');
    s.check('deliver', { evidence: 'Receipt 42' });
    s.run([packetCompleteCommand(s.c.snapshot('work'), s.p.id)]);
    expect(s.c.handoff('work', 'kit').completion).toMatchObject({
      checked: 4,
      skipped: 1,
      total: 5,
      taskStatus: 'done',
    });
    expect(validateState(s.c.snapshot('work'))).toEqual(s.c.snapshot('work'));
    s.service.close();
  });
  it('undo invalidates dependent results but preserves independent work and reopens completion', () => {
    const s = fixture();
    s.save();
    s.check('cut');
    s.check('label');
    s.check('inspect', { choice: 'no' });
    s.check('repair');
    s.run([
      {
        type: 'packet.confirm',
        id: s.p.id,
        requirementId: 'portal',
        available: true,
        evidence: 'Access checked',
      },
    ]);
    s.check('deliver');
    s.run([packetCompleteCommand(s.c.snapshot('work'), s.p.id)]);
    s.run([{ type: 'packet.check', id: s.p.id, stepId: 'cut', checked: false, evidence: '' }]);
    expect(s.c.handoff('work', 'kit').packet?.checks.map((c) => c.stepId)).toEqual(['label']);
    expect(s.c.handoff('work', 'kit').completion.taskStatus).toBe('active');
    expect(
      s.c
        .events('work')
        .events.some((e) =>
          e.commands.some((c) => c.type === 'packet.check' && c.stepId === 'deliver' && c.checked),
        ),
    ).toBe(true);
    s.service.close();
  });
  it('rejects self prerequisites, unknown edges, cycles and implicit replacement of a decision', () => {
    const s = fixture();
    s.p.requirements[0]!.itemId = 'kit';
    expect(() => s.save()).toThrow('own completion');
    s.p.requirements[0]!.itemId = null;
    s.p.steps[0]!.after = ['missing'];
    expect(() => s.save()).toThrow('unknown step');
    s.p.steps[0]!.after = ['deliver'];
    expect(() => s.save()).toThrow('cycle');
    s.p.steps[0]!.after = [];
    s.save();
    s.check('cut');
    s.check('label');
    s.check('inspect', { choice: 'yes' });
    expect(() => s.check('inspect', { choice: 'no' })).toThrow('Undo');
    s.service.close();
  });
  it('does not inherit another worker’s access confirmation', () => {
    const store = new MemoryStore(),
      s = fixture(store);
    s.save();
    s.check('cut');
    s.check('label');
    s.check('inspect', { choice: 'yes' });
    s.run([
      {
        type: 'packet.confirm',
        id: s.p.id,
        requirementId: 'portal',
        available: true,
        evidence: 'My account is ready',
      },
    ]);
    store.grant('work', 'colleague', 'editor');
    expect(s.c.handoff('work', 'kit').next.map((s) => s.stepId)).toContain('deliver');
    expect(s.service.connect('colleague').handoff('work', 'kit').next).toEqual([]);
    s.service.close();
  });
  it('requires an explicit coverage review and treats external-only inputs as inaccessible by default', () => {
    const s = fixture();
    s.p.execution!.coverage.inputs = 'unknown';
    expect(() => s.save()).toThrow('gaps');
    s.p.execution!.coverage.inputs = 'checked';
    s.p.steps[0]!.references = [
      {
        id: 'drawing',
        label: 'Drawing',
        kind: 'external',
        targetId: null,
        url: 'https://example.com/drawing#page=2',
        location: 'Page 2',
        page: 2,
        seconds: null,
        essential: true,
        purpose: 'input',
      },
    ];
    s.save();
    expect(s.c.handoff('work', 'kit').graph[0]?.blockers[0]?.code).toBe('access');
    expect(s.c.handoff('work', 'kit', { externalAccess: true }).graph[0]?.status).toBe('ready');
    s.service.close();
  });
});

describe.each(['memory', 'sqlite'])('original file storage: %s', (kind) => {
  it('stores exact bytes atomically, gates missing files, checks outputs, and isolates workspaces', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'statework-files-'));
    const store = kind === 'sqlite' ? new SqliteStore(join(dir, 'work.sqlite')) : new MemoryStore();
    const s = fixture(store);
    try {
      const bytes = new Uint8Array([0, 12, 255, 45]);
      const upload = {
        requestId: 'upload',
        expectedRevision: s.c.snapshot('work').workspace.revision,
        asset: {
          id: 'drawing',
          taskIds: ['kit'],
          name: 'drawing.cad',
          mediaType: 'application/octet-stream',
          description: 'Original geometry',
          locator: 'Original assignment',
          replaces: null,
        },
      };
      await s.c.attach('work', upload, bytes);
      expect(await s.c.attach('work', upload, bytes)).toEqual(
        await s.c.attach('work', upload, bytes),
      );
      expect(s.c.asset('work', 'drawing').bytes).toEqual(bytes);
      const bundle = s.c.exportBundle('work');
      const withFiles = await s.c.importBundle(bundle, { id: 'portable', title: 'Portable copy' });
      expect(withFiles.instructions?.assets).toHaveLength(1);
      expect(s.c.asset('portable', 'drawing').bytes).toEqual(bytes);
      const corrupt = structuredClone(bundle);
      corrupt.files[0]!.base64 = 'AQIDBA==';
      await expect(
        s.c.importBundle(corrupt, { id: 'corrupt', title: 'Corrupt import' }),
      ).rejects.toThrow('identity');
      expect(s.c.list().some((w) => w.id === 'corrupt')).toBe(false);
      const absent = structuredClone(bundle);
      absent.files = [];
      await expect(
        s.c.importBundle(absent, { id: 'absent', title: 'Incomplete manifest' }),
      ).rejects.toThrow('every file identity');
      expect(s.c.assetManifest('work')[0]?.available).toBe(true);
      const meta = s.c.assetManifest('work')[0]!;
      const { capturedAt: _at, capturedBy: _by, available: _available, ...identity } = meta;
      expect(() =>
        s.run([
          {
            type: 'asset.register',
            asset: { ...identity, id: 'conflicting-size', size: identity.size + 1 },
          },
        ]),
      ).toThrow('conflicting sizes');
      const snapshotCopy = s.c.import(s.c.export('work'), { id: 'copy', title: 'Metadata copy' });
      expect(snapshotCopy.instructions?.assets?.[0]?.sha256).toBe(meta.sha256);
      expect(s.c.assetManifest('copy')[0]?.available).toBe(false);
      await expect(s.c.restoreAsset('copy', 'drawing', new Uint8Array([4]))).rejects.toThrow(
        'identity',
      );
      await s.c.restoreAsset('copy', 'drawing', bytes);
      expect(s.c.asset('copy', 'drawing').bytes).toEqual(bytes);
      const stranger = s.service.connect('stranger');
      expect(() => stranger.asset('work', 'drawing')).toThrow('unavailable');
      s.p.execution!.outputs = [
        {
          id: 'model',
          label: 'Finished CAD file',
          description: 'A square measured 20 mm on each side.',
          stepId: 'cut',
          required: true,
        },
      ];
      s.p.steps[0]!.references = [
        {
          id: 'drawing-ref',
          label: 'Drawing',
          kind: 'asset',
          targetId: 'drawing',
          url: '',
          location: 'Complete model',
          page: null,
          seconds: null,
          essential: true,
          purpose: 'input',
        },
      ];
      s.save();
      expect(() => s.check('cut')).toThrow('required output');
      s.check('cut', { outputs: [{ outputId: 'model', assetId: 'drawing' }] });
      expect(packetIssues(s.c.snapshot('work'), s.c.handoff('work', 'kit').packet!)).toEqual([]);
      const secondCopy = s.c.import(s.c.export('work'), { id: 'missing', title: 'Missing files' });
      expect(secondCopy.instructions?.packets).toHaveLength(1);
      expect(s.c.handoff('missing', 'kit').assets[0]?.available).toBe(false);
      s.c.execute('missing', {
        schemaVersion: 1,
        requestId: 'check-with-missing-file',
        expectedRevision: 0,
        commands: [
          {
            type: 'packet.check',
            id: 'packet',
            stepId: 'label',
            checked: true,
            evidence: 'label',
          },
        ],
      });
      expect(s.c.handoff('missing', 'kit').graph.find((s) => s.id === 'inspect')?.blockers).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'file', target: 'drawing' })]),
      );
      expect(() =>
        s.c.execute('missing', {
          schemaVersion: 1,
          requestId: 'dependent-missing-file',
          expectedRevision: 1,
          commands: [
            {
              type: 'packet.check',
              id: 'packet',
              stepId: 'inspect',
              checked: true,
              evidence: 'Inspect',
              choice: 'yes',
            },
          ],
        }),
      ).toThrow('original or result file');
    } finally {
      s.service.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('proposal grounding regressions from the CAD audit', () => {
  it.each(['Draft-angle correction', 'Linkage assembly', '3D sketch'])(
    'keeps %s blocked when there are only navigation notes',
    (title) => {
      const s = fixture();
      const state = s.c.snapshot('work');
      state.instructions!.sources = [];
      const context = packetContext(state, 'kit');
      const p = blankPacket(state, 'kit', 'model-draft');
      p.title = title;
      p.outcome = 'Completed model';
      p.finish = 'Upload the correct result';
      p.sourceIds = ['task', 'items'];
      p.steps = [
        {
          id: 'model',
          title: 'Make exercise',
          instruction: 'Follow the external course assignment.',
          expected: 'Matches the assignment.',
          ifBlocked: 'Open the assignment.',
          actionUrl: '',
          minutes: 30,
          requires: ['self'],
          citations: Array.from({ length: 15 }, () => ({
            sourceId: 'task',
            quote: 'Invented dimensions',
            location: 'Task notes',
          })),
        },
      ];
      p.requirements = [
        {
          id: 'self',
          label: title,
          kind: 'task',
          itemId: 'kit',
          detail: 'Have the model complete.',
          check: 'Done',
          confirmed: true,
          url: '',
          citations: [],
        },
      ];
      const result = parse(packetInputSchema, reconcilePacketProposal(context, p));
      expect(result.sourceIds).toEqual([]);
      expect(result.steps[0]!.citations).toEqual([]);
      expect(result.requirements[0]!.itemId).toBeNull();
      expect(result.requirements[0]!.confirmed).toBe(false);
      expect(result.questions).toHaveLength(2);
      expect(result.questions.every((q) => !q.answer)).toBe(true);
      expect(packetIssues(state, result).some((i) => i.code === 'question')).toBe(true);
      expect(packetIssues(state, result).length).toBeLessThan(8);
      s.service.close();
    },
  );
});
