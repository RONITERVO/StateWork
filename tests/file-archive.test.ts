import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  MemoryStore,
  WorkService,
  blankPacket,
  packetCompleteCommand,
  packetContext,
  validateState,
} from '@statework/sdk';
import type { Command, PacketInput, WorkspaceStore } from '@statework/sdk';
import { SqliteStore } from '@statework/node';

const at = '2026-09-09T12:00:00.000Z';
const reason = 'Decorative website graphic; retain the original for history.';
const bytes = new Uint8Array([0, 255, 9, 42, 128, 0, 1]);
async function fixture(store: WorkspaceStore = new MemoryStore()) {
  const service = new WorkService(store, () => at);
  const c = service.connect('owner');
  c.create({ id: 'work', title: 'Workshop' });
  let serial = 0;
  const request = (commands: Command[]) => ({
    schemaVersion: 1 as const,
    requestId: `request-${++serial}`,
    expectedRevision: c.snapshot('work').workspace.revision,
    commands,
  });
  const run = (commands: Command[]) => c.execute('work', request(commands));
  run([{ type: 'item.create', item: { id: 'task', kind: 'task', title: 'Prepare work' } }]);
  await c.attach(
    'work',
    {
      requestId: 'upload',
      expectedRevision: c.snapshot('work').workspace.revision,
      asset: {
        id: 'graphic',
        taskIds: ['task'],
        name: 'original.png',
        mediaType: 'image/png',
        description: 'Original site decoration',
        locator: 'https://example.com/decoration.png',
        replaces: null,
      },
    },
    bytes,
  );
  run([
    {
      type: 'source.capture',
      source: {
        id: 'author',
        title: 'Author instructions',
        taskIds: ['task'],
        locator: 'Author note',
        kind: 'note',
        coverage: 'complete',
        content: 'Check the finished work.',
        replaces: null,
      },
    },
  ]);
  const packet = (id = 'packet'): PacketInput => {
    const p = blankPacket(c.snapshot('work'), 'task', id);
    p.contextKey = packetContext(c.snapshot('work'), 'task').procedureKey!;
    p.sourceIds = ['author'];
    p.outcome = 'Finished work checked.';
    p.finish = 'Record the check.';
    p.execution = {
      version: 1,
      completion: { anyOf: ['step-1'] },
      coverage: {
        inputs: 'checked',
        procedure: 'checked',
        acceptance: 'checked',
        note: 'Author checked.',
      },
      outputs: [],
    };
    Object.assign(p.steps[0]!, {
      instruction: 'Check the finished work.',
      expected: 'The work matches the author instructions.',
      ifBlocked: 'Ask the author.',
      citations: [{ sourceId: 'author', quote: 'Check the finished work.', location: 'Note' }],
    });
    return p;
  };
  const reference = (kind: 'asset' | 'source', targetId: string) => ({
    id: 'reference',
    kind,
    targetId,
    label: 'Original',
    location: 'Complete original',
    url: '',
    page: null,
    seconds: null,
    essential: false,
    purpose: 'example' as const,
  });
  const archive = (archived = true): Command => ({
    type: 'asset.archive',
    id: 'graphic',
    archived,
    reason,
  });
  const captureOriginal = () =>
    run([
      {
        type: 'source.capture',
        source: {
          id: 'original-source',
          title: 'Original source',
          taskIds: ['task'],
          locator: 'Original file',
          kind: 'file',
          coverage: 'complete',
          content: 'Check the finished work.',
          replaces: null,
          assetId: 'graphic',
        },
      },
    ]);
  return { store, service, c, request, run, packet, reference, archive, captureOriginal };
}

describe('reversible original-file archive', () => {
  it('enforces membership, write permission, revision checks and request idempotency', async () => {
    const store = new MemoryStore();
    const s = await fixture(store);
    store.grant('work', 'reader', 'reader');
    store.grant('work', 'editor', 'editor');
    const request = s.request([s.archive()]);
    expect(() => s.service.connect('stranger').execute('work', request)).toThrow('unavailable');
    expect(() => s.service.connect('reader').execute('work', request)).toThrow('read-only');
    expect(() => s.c.execute('work', { ...request, expectedRevision: 0 })).toThrow('changed');
    const first = s.service.connect('editor').execute('work', request);
    expect(s.service.connect('editor').execute('work', request)).toEqual(first);
    expect(s.c.snapshot('work').workspace.revision).toBe(request.expectedRevision + 1);
    expect(s.c.events('work', request.expectedRevision).events).toEqual([first.event]);
    expect(s.c.assetManifest('work')[0]!.archive).toEqual({ at, by: 'editor', reason });
    expect(() =>
      s.service.connect('editor').execute('work', {
        ...request,
        commands: [s.archive(false)],
      }),
    ).toThrow('different content');
    expect(() => s.run([{ ...s.archive(), reason: ' ' } as Command])).toThrow();
    expect(() => s.run([{ type: 'asset.archive', id: 'absent', archived: true, reason }])).toThrow(
      'unavailable',
    );
    s.service.close();
  });

  it.each(['asset', 'source', 'source-list', 'citation', 'output'] as const)(
    'rejects archiving a file still used by a latest packet through %s',
    async (usage) => {
      const s = await fixture();
      if (usage === 'source' || usage === 'source-list' || usage === 'citation')
        s.captureOriginal();
      const p = s.packet();
      if (usage === 'asset') p.steps[0]!.references = [s.reference('asset', 'graphic')];
      if (usage === 'source') p.steps[0]!.references = [s.reference('source', 'original-source')];
      if (usage === 'source-list') p.sourceIds.push('original-source');
      if (usage === 'citation') p.steps[0]!.citations[0]!.sourceId = 'original-source';
      if (usage === 'output')
        p.execution!.outputs = [
          {
            id: 'result',
            label: 'Result',
            description: 'Checked original',
            stepId: 'step-1',
            required: true,
          },
        ];
      s.run([{ type: 'packet.save', packet: p, expectedPacketId: null }]);
      if (usage === 'output')
        s.run([
          { type: 'packet.review', id: p.id },
          {
            type: 'packet.check',
            id: p.id,
            stepId: 'step-1',
            checked: true,
            evidence: 'Checked',
            outputs: [{ outputId: 'result', assetId: 'graphic' }],
          },
        ]);
      const before = s.c.snapshot('work');
      expect(() => s.run([s.archive()])).toThrow('current instructions or results');
      expect(s.c.snapshot('work')).toEqual(before);
      expect(s.c.asset('work', 'graphic').bytes).toEqual(bytes);
      s.service.close();
    },
  );

  it('checks latest packets for every task and rolls back a mixed batch', async () => {
    const s = await fixture();
    const p = s.packet();
    p.steps[0]!.references = [s.reference('asset', 'graphic')];
    s.run([
      { type: 'packet.save', packet: p, expectedPacketId: null },
      { type: 'item.create', item: { id: 'other', kind: 'task', title: 'Other task' } },
    ]);
    const other = blankPacket(s.c.snapshot('work'), 'other', 'other-packet');
    s.run([{ type: 'packet.save', packet: other, expectedPacketId: null }]);
    const before = s.c.snapshot('work');
    expect(() =>
      s.run([{ type: 'workspace.rename', title: 'Should roll back' }, s.archive()]),
    ).toThrow('current instructions or results');
    expect(s.c.snapshot('work')).toEqual(before);
    s.service.close();
  });

  it.each(['memory', 'sqlite'] as const)(
    'retains exact originals, historical references, completion and portable archive metadata (%s)',
    async (adapter) => {
      const s = await fixture(
        adapter === 'memory' ? new MemoryStore() : new SqliteStore(':memory:'),
      );
      s.captureOriginal();
      const old = s.packet('old');
      old.sourceIds.push('original-source');
      old.steps[0]!.references = [s.reference('asset', 'graphic')];
      old.execution!.outputs = [
        {
          id: 'result',
          label: 'Result',
          description: 'Exact original',
          stepId: 'step-1',
          required: true,
        },
      ];
      s.run([
        { type: 'packet.save', packet: old, expectedPacketId: null },
        { type: 'packet.review', id: old.id },
        {
          type: 'packet.check',
          id: old.id,
          stepId: 'step-1',
          checked: true,
          evidence: 'Original checked',
          outputs: [{ outputId: 'result', assetId: 'graphic' }],
        },
      ]);
      const current = s.packet('current');
      s.run([
        { type: 'packet.save', packet: current, expectedPacketId: old.id },
        { type: 'packet.review', id: current.id },
        {
          type: 'packet.check',
          id: current.id,
          stepId: 'step-1',
          checked: true,
          evidence: 'Current checked',
        },
      ]);
      s.run([packetCompleteCommand(s.c.snapshot('work'), current.id)]);
      const before = s.c.snapshot('work');
      const context = packetContext(before, 'task');
      const handoff = s.c.handoff('work', 'task');
      s.run([s.archive()]);
      const after = s.c.snapshot('work');
      expect(after.items).toEqual(before.items);
      expect(after.instructions!.packets).toEqual(before.instructions!.packets);
      expect(after.instructions!.sources).toEqual(before.instructions!.sources);
      expect(after.instructions!.assets![0]).toEqual({
        ...before.instructions!.assets![0],
        archive: { at, by: 'owner', reason },
      });
      expect(packetContext(after, 'task')).toEqual({ ...context, assets: [] });
      expect(s.c.handoff('work', 'task').next).toEqual(handoff.next);
      expect(s.c.handoff('work', 'task').assets).toEqual([]);
      expect(s.c.asset('work', 'graphic').bytes).toEqual(bytes);
      expect(s.c.assetManifest('work')[0]!.available).toBe(true);
      expect(s.c.source('work', 'original-source').assetId).toBe('graphic');
      expect(validateState(after)).toEqual(after);
      const snapshotCopy = s.c.import(s.c.export('work'), {
        id: 'snapshot-copy',
        title: 'Snapshot',
      });
      expect(snapshotCopy.instructions).toEqual(after.instructions);
      const bundle = s.c.exportBundle('work');
      expect(bundle.missing).toEqual([]);
      expect(bundle.files).toHaveLength(1);
      const copy = await s.c.importBundle(bundle, { id: 'copy', title: 'Copy' });
      expect(copy.instructions).toEqual(after.instructions);
      expect(s.c.asset('copy', 'graphic').bytes).toEqual(bytes);
      const originalPackage = s.c.exportFilePackage('work', (manifest, read) => ({
        manifest,
        originals: new Map(manifest.files.map((id) => [id, read(id)])),
      }));
      const packageCopy = s.c.importFilePackage(
        originalPackage.manifest,
        { id: 'package-copy', title: 'Package' },
        {
          read: (id) => originalPackage.originals.get(id)!,
          digest: (content) => createHash('sha256').update(content).digest('hex'),
        },
      );
      expect(packageCopy.instructions).toEqual(after.instructions);
      expect(s.c.asset('package-copy', 'graphic').bytes).toEqual(bytes);
      s.run([s.archive(false)]);
      expect(s.c.snapshot('work').instructions).toEqual(before.instructions);
      expect(packetContext(s.c.snapshot('work'), 'task')).toEqual(context);
      expect(s.c.asset('work', 'graphic').bytes).toEqual(bytes);
      s.service.close();
    },
  );

  it.each(['asset', 'source', 'output'] as const)(
    'rejects forged current %s archive metadata before snapshot, bundle or package import',
    async (usage) => {
      const s = await fixture();
      if (usage === 'source') s.captureOriginal();
      const p = s.packet();
      if (usage === 'asset') p.steps[0]!.references = [s.reference('asset', 'graphic')];
      if (usage === 'source') p.sourceIds.push('original-source');
      if (usage === 'output')
        p.execution!.outputs = [
          {
            id: 'result',
            label: 'Result',
            description: 'Checked file',
            stepId: 'step-1',
            required: true,
          },
        ];
      s.run([{ type: 'packet.save', packet: p, expectedPacketId: null }]);
      if (usage === 'output')
        s.run([
          { type: 'packet.review', id: p.id },
          {
            type: 'packet.check',
            id: p.id,
            stepId: 'step-1',
            checked: true,
            evidence: 'Checked',
            outputs: [{ outputId: 'result', assetId: 'graphic' }],
          },
        ]);
      s.run([{ type: 'item.create', item: { id: 'other', kind: 'task', title: 'Other task' } }]);
      const other = blankPacket(s.c.snapshot('work'), 'other', 'other-packet');
      s.run([{ type: 'packet.save', packet: other, expectedPacketId: null }]);
      const snapshot = s.c.export('work');
      snapshot.state.instructions!.assets![0]!.archive = { at, by: 'owner', reason };
      expect(() => validateState(snapshot.state)).toThrow('reference an archived file');
      expect(() => s.c.import(snapshot, { id: 'bad-snapshot', title: 'Forged' })).toThrow(
        'reference an archived file',
      );
      const bundle = s.c.exportBundle('work');
      bundle.snapshot = snapshot;
      await expect(s.c.importBundle(bundle, { id: 'bad-bundle', title: 'Forged' })).rejects.toThrow(
        'reference an archived file',
      );
      const manifest = s.c.exportFilePackage('work', (value) => value);
      manifest.snapshot = snapshot;
      const read = vi.fn(() => bytes);
      expect(() =>
        s.c.importFilePackage(
          manifest,
          { id: 'bad-package', title: 'Forged' },
          {
            read,
            digest: (content) => createHash('sha256').update(content).digest('hex'),
          },
        ),
      ).toThrow('reference an archived file');
      expect(read).not.toHaveBeenCalled();
      expect(s.c.list().map((workspace) => workspace.id)).toEqual(['work']);
      expect(s.c.asset('work', 'graphic').bytes).toEqual(bytes);
      s.service.close();
    },
  );

  it('requires explicit restoration before an archived file is used in new instructions or results', async () => {
    const s = await fixture();
    s.captureOriginal();
    s.run([s.archive()]);
    const p = s.packet();
    p.steps[0]!.references = [s.reference('asset', 'graphic')];
    expect(() => s.run([{ type: 'packet.save', packet: p, expectedPacketId: null }])).toThrow(
      'Restore archived files',
    );
    p.steps[0]!.references = [];
    p.sourceIds.push('original-source');
    expect(() => s.run([{ type: 'packet.save', packet: p, expectedPacketId: null }])).toThrow(
      'Restore archived files',
    );
    p.sourceIds = ['author'];
    p.execution!.outputs = [
      {
        id: 'result',
        label: 'Result',
        description: 'Checked file',
        stepId: 'step-1',
        required: true,
      },
    ];
    s.run([
      { type: 'packet.save', packet: p, expectedPacketId: null },
      { type: 'packet.review', id: p.id },
    ]);
    const check: Command = {
      type: 'packet.check',
      id: p.id,
      stepId: 'step-1',
      checked: true,
      evidence: 'Checked',
      outputs: [{ outputId: 'result', assetId: 'graphic' }],
    };
    expect(() => s.run([check])).toThrow('Result files');
    s.run([s.archive(false), check]);
    expect(s.c.snapshot('work').instructions!.packets[0]!.checks).toHaveLength(1);
    s.service.close();
  });
});

describe('file task associations', () => {
  it.each(['memory', 'sqlite'] as const)(
    'moves associations without changing originals, captured sources or input references (%s)',
    async (adapter) => {
      const s = await fixture(
        adapter === 'memory' ? new MemoryStore() : new SqliteStore(':memory:'),
      );
      s.captureOriginal();
      s.run([
        { type: 'item.create', item: { id: 'correct', kind: 'task', title: 'Correct task' } },
      ]);
      const packet = s.packet();
      packet.sourceIds.push('original-source');
      packet.steps[0]!.references = [s.reference('asset', 'graphic')];
      s.run([
        { type: 'packet.save', packet, expectedPacketId: null },
        { type: 'packet.review', id: packet.id },
      ]);
      const before = s.c.snapshot('work');
      const result = s.run([
        {
          type: 'asset.relink',
          id: 'graphic',
          taskIds: ['correct'],
          reason: 'The original belongs to the corrected task scope.',
        },
      ]);
      const after = s.c.snapshot('work');
      expect(after.instructions!.assets![0]).toEqual({
        ...before.instructions!.assets![0],
        taskIds: ['correct'],
      });
      expect(after.instructions!.packets).toEqual(before.instructions!.packets);
      expect(after.instructions!.sources).toEqual(before.instructions!.sources);
      expect(after.items).toEqual(before.items);
      expect(packetContext(after, 'task').assets).toEqual([]);
      expect(packetContext(after, 'correct').assets?.map((asset) => asset.id)).toEqual(['graphic']);
      expect(s.c.handoff('work', 'task').assets[0]!.id).toBe('graphic');
      expect(s.c.asset('work', 'graphic').bytes).toEqual(bytes);
      expect(s.c.storageInfo('work')).toMatchObject({
        assetCount: 1,
        uniqueFiles: 1,
        storedBytes: bytes.length,
      });
      expect(s.c.events('work', before.workspace.revision).events).toEqual([result.event]);
      expect(validateState(after)).toEqual(after);
      const copy = await s.c.importBundle(s.c.exportBundle('work'), { id: 'copy', title: 'Copy' });
      expect(copy.instructions).toEqual(after.instructions);
      expect(s.c.asset('copy', 'graphic').bytes).toEqual(bytes);
      s.run([
        {
          type: 'asset.relink',
          id: 'graphic',
          taskIds: ['task'],
          reason: 'Restore the previous organization.',
        },
      ]);
      expect(s.c.snapshot('work').instructions).toEqual(before.instructions);
      s.service.close();
    },
  );

  it('checks permissions, task IDs and revisions, and records an editor retry only once', async () => {
    const store = new MemoryStore();
    const s = await fixture(store);
    store.grant('work', 'reader', 'reader');
    store.grant('work', 'editor', 'editor');
    s.run([{ type: 'item.create', item: { id: 'correct', kind: 'task', title: 'Correct task' } }]);
    const command: Command = {
      type: 'asset.relink',
      id: 'graphic',
      taskIds: ['correct'],
      reason: 'Correct the source-supported association.',
    };
    const request = s.request([command]);
    const before = s.c.snapshot('work');
    expect(() => s.service.connect('reader').execute('work', request)).toThrow('read-only');
    expect(() => s.service.connect('stranger').execute('work', request)).toThrow('unavailable');
    expect(() => s.c.execute('work', { ...request, expectedRevision: 0 })).toThrow('changed');
    for (const taskIds of [
      [],
      ['task', 'task'],
      ['absent'],
      Array.from({ length: 101 }, (_, i) => `task-${i}`),
    ])
      expect(() => s.run([{ ...command, taskIds }])).toThrow();
    expect(() => s.run([{ ...command, id: 'absent' }])).toThrow('unavailable');
    expect(() => s.run([{ ...command, reason: ' ' }])).toThrow();
    expect(s.c.snapshot('work')).toEqual(before);
    const first = s.service.connect('editor').execute('work', request);
    expect(s.service.connect('editor').execute('work', request)).toEqual(first);
    expect(s.c.events('work', before.workspace.revision).events).toEqual([first.event]);
    expect(first.event).toMatchObject({ actorId: 'editor', commands: [command] });
    s.service.close();
  });

  it('retains task bindings of current and historical checked outputs, even after file archive', async () => {
    const s = await fixture();
    s.run([{ type: 'item.create', item: { id: 'other', kind: 'task', title: 'Other task' } }]);
    const old = s.packet('old');
    old.execution!.outputs = [
      {
        id: 'result',
        label: 'Result',
        description: 'Checked original',
        stepId: 'step-1',
        required: true,
      },
    ];
    s.run([
      { type: 'packet.save', packet: old, expectedPacketId: null },
      { type: 'packet.review', id: old.id },
      {
        type: 'packet.check',
        id: old.id,
        stepId: 'step-1',
        checked: true,
        evidence: 'Checked',
        outputs: [{ outputId: 'result', assetId: 'graphic' }],
      },
    ]);
    const relink: Command = {
      type: 'asset.relink',
      id: 'graphic',
      taskIds: ['other'],
      reason: 'Reorganize task files.',
    };
    expect(() => s.run([relink])).toThrow('recorded result files');
    s.run([{ type: 'packet.save', packet: s.packet('current'), expectedPacketId: old.id }]);
    s.run([s.archive()]);
    const before = s.c.snapshot('work');
    expect(() => s.run([{ type: 'workspace.rename', title: 'Roll back' }, relink])).toThrow(
      'earlier packet revisions',
    );
    expect(s.c.snapshot('work')).toEqual(before);
    s.run([{ ...relink, taskIds: ['task', 'other'] }]);
    const after = s.c.snapshot('work');
    expect(after.instructions!.assets![0]).toEqual({
      ...before.instructions!.assets![0],
      taskIds: ['task', 'other'],
    });
    expect(after.instructions!.packets).toEqual(before.instructions!.packets);
    expect(s.c.asset('work', 'graphic').bytes).toEqual(bytes);
    expect(validateState(after)).toEqual(after);
    s.service.close();
  });
});
