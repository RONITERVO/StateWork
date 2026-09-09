import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  WorkService,
  MemoryStore,
  blankPacket,
  packetContext,
  packetIssues,
  latestPacket,
  packetCompleteCommand,
  parse,
  packetInputSchema,
  validateState,
} from '@statework/sdk';
import type { Command, PacketInput } from '@statework/sdk';
import { SqliteStore, extractSource, publicAddress, fetchSource } from '@statework/node';

const at = '2026-09-09T08:00:00.000Z';
function setup(sqlite = false) {
  const store = sqlite ? new SqliteStore(':memory:') : new MemoryStore();
  const service = new WorkService(store, () => at);
  const c = service.connect('owner');
  c.create({ id: 'w', title: 'Workshop' });
  let counter = 0;
  const run = (commands: Command[]) =>
    c.execute('w', {
      schemaVersion: 1,
      requestId: `r${counter++}`,
      expectedRevision: c.snapshot('w').workspace.revision,
      commands,
    });
  run([
    {
      type: 'item.create',
      item: {
        id: 'task',
        title: 'Prepare kit',
        kind: 'task',
        description: 'Prepare the blue kit.',
      },
    },
    {
      type: 'item.create',
      item: {
        id: 'tools',
        title: 'Get tools',
        kind: 'task',
        status: 'done',
        description: 'Use the blue storage tray.',
      },
    },
    {
      type: 'relation.add',
      relation: { id: 'dep', kind: 'depends_on', from: 'task', to: 'tools' },
    },
  ]);
  return { store, service, c, run };
}
function ready(s: ReturnType<typeof setup>, id = 'p1'): PacketInput {
  s.run([
    {
      type: 'source.capture',
      source: {
        id: `source-${id}`,
        taskIds: ['task'],
        title: 'Kit procedure',
        locator: 'Workshop handbook, section 2',
        content:
          'Place two M6 bolts in the blue tray. Count exactly two bolts. If a bolt is missing, take it from drawer A. Label the tray KIT 1. Check the label reads KIT 1. If the label is unreadable, replace it.',
        kind: 'note',
        coverage: 'complete',
        replaces: null,
      },
    },
  ]);
  const p = blankPacket(s.c.snapshot('w'), 'task', id);
  p.outcome = 'Blue tray with two bolts and KIT 1 label.';
  p.finish = 'Count two M6 bolts and read KIT 1 on the blue tray. Leave it on shelf B.';
  p.requirements[0]!.check = 'Blue tray is available at the bench.';
  p.steps = [
    {
      id: 'count',
      title: 'Count bolts',
      instruction: 'Place two M6 bolts in the blue tray.',
      expected: 'Exactly two M6 bolts are in the tray.',
      ifBlocked: 'Take a missing bolt from drawer A.',
      minutes: 2,
      actionUrl: '',
      requires: [p.requirements[0]!.id],
      citations: [
        {
          sourceId: `source-${id}`,
          quote: 'Place two M6 bolts in the blue tray.',
          location: 'Section 2',
        },
      ],
    },
    {
      id: 'label',
      title: 'Label tray',
      instruction: 'Label the tray KIT 1.',
      expected: 'The label reads KIT 1.',
      ifBlocked: 'Replace an unreadable label.',
      minutes: 1,
      actionUrl: '',
      requires: [],
      citations: [
        { sourceId: `source-${id}`, quote: 'Label the tray KIT 1.', location: 'Section 2' },
      ],
    },
  ];
  return p;
}
describe('evidence-backed work packets', () => {
  it('keeps long task notes available in context without making the manual draft invalid', () => {
    const s = setup();
    const description = 'Detailed original notes. '.repeat(750);
    s.run(
      ['task', 'tools'].map((id) => ({
        type: 'item.update' as const,
        id,
        expectedVersion: 1,
        patch: { description },
      })),
    );
    const state = s.c.snapshot('w');
    const draft = parse(packetInputSchema, blankPacket(state, 'task', 'long-notes'));
    expect(draft.steps[0]!.instruction).toBe('');
    expect(packetContext(state, 'task').task.description).toBe(description);
    expect(packetIssues(state, draft).some((i) => i.code === 'missing')).toBe(true);
    s.service.close();
  });
  it('supports the full manual workflow in SQLite, with exact retries, records and export', () => {
    const s = setup(true);
    const p = ready(s);
    s.run([{ type: 'packet.save', packet: p, expectedPacketId: null }]);
    expect(
      packetIssues(s.c.snapshot('w'), latestPacket(s.c.snapshot('w'), 'task')!).map((i) => i.code),
    ).toEqual(['review']);
    expect(() =>
      s.run([{ type: 'item.update', id: 'task', expectedVersion: 1, patch: { status: 'done' } }]),
    ).toThrow('packet');
    s.run([{ type: 'packet.review', id: p.id }]);
    expect(() =>
      s.run([{ type: 'packet.check', id: p.id, stepId: 'label', checked: true, evidence: '' }]),
    ).toThrow('earlier');
    s.run([
      { type: 'packet.check', id: p.id, stepId: 'count', checked: true, evidence: '2 bolts' },
    ]);
    s.run([{ type: 'packet.check', id: p.id, stepId: 'label', checked: true, evidence: 'KIT 1' }]);
    s.run([packetCompleteCommand(s.c.snapshot('w'), p.id)]);
    expect(s.c.snapshot('w').items.find((i) => i.id === 'task')?.status).toBe('done');
    const snapshot = s.c.export('w');
    expect(validateState(snapshot.state)).toEqual(snapshot.state);
    expect(
      s.c.import(snapshot, { id: 'copy', title: 'Copy' }).instructions?.packets[0]?.checks,
    ).toHaveLength(2);
    expect(s.c.events('w').events.at(-1)?.commands[0]?.type).toBe('item.update');
    s.service.close();
  });
  it('blocks unknown evidence, false citations, unread links and unresolved questions', () => {
    const s = setup();
    let p = ready(s);
    p.steps[0]!.citations[0]!.quote = 'Invented measurement';
    p.questions.push({
      id: 'q',
      question: 'Which revision?',
      resolve: 'Check the handbook owner.',
      url: '',
      answer: '',
      citations: [],
    });
    s.run([{ type: 'packet.save', packet: p, expectedPacketId: null }]);
    expect(() => s.run([{ type: 'packet.review', id: p.id }])).toThrow('gaps');
    expect(packetIssues(s.c.snapshot('w'), p, false).map((i) => i.code)).toEqual(
      expect.arrayContaining(['citation', 'question']),
    );
    s.run([
      {
        type: 'item.update',
        id: 'task',
        expectedVersion: 1,
        patch: { description: 'Read https://example.com/requirements' },
      },
    ]);
    p = { ...p, id: 'p2', contextKey: packetContext(s.c.snapshot('w'), 'task').key };
    expect(packetIssues(s.c.snapshot('w'), p, false).some((i) => i.code === 'source')).toBe(true);
    s.service.close();
  });
  it('detects changed context and replaced sources without discarding earlier captures', () => {
    const s = setup();
    const p = ready(s);
    s.run([
      { type: 'packet.save', packet: p, expectedPacketId: null },
      { type: 'packet.review', id: p.id },
    ]);
    s.run([{ type: 'item.update', id: 'task', expectedVersion: 1, patch: { status: 'active' } }]);
    expect(packetIssues(s.c.snapshot('w'), latestPacket(s.c.snapshot('w'), 'task')!)).toEqual([]);
    s.run([
      {
        type: 'source.capture',
        source: {
          id: 'replacement',
          taskIds: ['task'],
          title: 'Updated kit procedure',
          locator: 'Workshop handbook, section 2',
          kind: 'note',
          coverage: 'complete',
          replaces: 'source-p1',
          content: 'New instructions.',
        },
      },
    ]);
    expect(s.c.snapshot('w').instructions?.sources).toHaveLength(2);
    expect(
      packetIssues(s.c.snapshot('w'), p, false).filter((i) => i.code === 'stale'),
    ).toHaveLength(2);
    expect(() =>
      s.run([{ type: 'packet.check', id: p.id, stepId: 'count', checked: true, evidence: '' }]),
    ).toThrow('gaps');
    s.service.close();
  });
  it('invalidates task/prerequisite changes and prevents stale draft overwrites', () => {
    const s = setup();
    const p = ready(s);
    s.run([{ type: 'item.update', id: 'tools', expectedVersion: 1, patch: { status: 'ready' } }]);
    expect(() => s.run([{ type: 'packet.save', packet: p, expectedPacketId: null }])).toThrow(
      'context',
    );
    p.contextKey = packetContext(s.c.snapshot('w'), 'task').key;
    s.run([{ type: 'packet.save', packet: p, expectedPacketId: null }]);
    expect(packetIssues(s.c.snapshot('w'), p, false).some((i) => i.code === 'requirement')).toBe(
      true,
    );
    expect(() =>
      s.run([{ type: 'packet.save', packet: { ...p, id: 'p2' }, expectedPacketId: null }]),
    ).toThrow('changed');
    s.service.close();
  });
  it('revisions reset review and progress and preserve the previous packet', () => {
    const s = setup();
    const p = ready(s);
    s.run([
      { type: 'packet.save', packet: p, expectedPacketId: null },
      { type: 'packet.review', id: p.id },
      { type: 'packet.check', id: p.id, stepId: 'count', checked: true, evidence: 'two' },
    ]);
    s.run([{ type: 'packet.save', packet: { ...p, id: 'p2' }, expectedPacketId: p.id }]);
    const packets = s.c.snapshot('w').instructions!.packets;
    expect(packets[0]!.checks).toHaveLength(1);
    expect(packets[1]!.checks).toEqual([]);
    expect(packets[1]!.review).toBeNull();
    expect(() => s.run([{ type: 'packet.review', id: p.id }])).toThrow('latest');
    s.service.close();
  });
  it('requires writer access and makes command retries idempotent', () => {
    const s = setup();
    const p = ready(s);
    s.store.grant('w', 'reader', 'reader');
    expect(() =>
      s.service.connect('reader').execute('w', {
        schemaVersion: 1,
        requestId: 'x',
        expectedRevision: s.c.snapshot('w').workspace.revision,
        commands: [{ type: 'packet.save', packet: p, expectedPacketId: null }],
      }),
    ).toThrow('read-only');
    const request = {
      schemaVersion: 1,
      requestId: 'retry',
      expectedRevision: s.c.snapshot('w').workspace.revision,
      commands: [{ type: 'packet.save', packet: p, expectedPacketId: null }],
    };
    expect(s.c.execute('w', request)).toEqual(s.c.execute('w', request));
    expect(s.c.snapshot('w').instructions!.packets).toHaveLength(1);
    s.service.close();
  });
  it('strictly validates packet shapes and rejects executable action links', () => {
    const s = setup(),
      p = ready(s);
    expect(() => parse(packetInputSchema, { ...p, review: { by: 'owner', at } })).toThrow();
    expect(() => parse(packetInputSchema, { ...p, steps: [p.steps[0], p.steps[0]] })).toThrow();
    expect(() =>
      parse(packetInputSchema, {
        ...p,
        steps: [{ ...p.steps[0], actionUrl: 'javascript:alert(1)' }],
      }),
    ).toThrow();
    s.service.close();
  });
  it('collects ancestor and prerequisite context without unrelated projects', () => {
    const s = setup();
    s.run([
      { type: 'item.create', item: { id: 'project', title: 'Kit delivery', kind: 'project' } },
      { type: 'item.create', item: { id: 'other', title: 'Unrelated', kind: 'task' } },
      {
        type: 'relation.add',
        relation: { id: 'parent', kind: 'contains', from: 'project', to: 'task' },
      },
    ]);
    const c = packetContext(s.c.snapshot('w'), 'task');
    expect(c.items.map((i) => i.id)).toEqual(['project', 'task', 'tools']);
    s.service.close();
  });
});
describe('local source extraction', () => {
  it('extracts PDF pages and DOCX text with explicit visual coverage warnings', async () => {
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    const stream = 'BT /F1 12 Tf 50 790 Td (Place two M6 bolts in the blue tray.) Tj ET';
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((o, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
      .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const result = await extractSource('kit.pdf', new TextEncoder().encode(pdf));
    expect(result.content).toContain('[Page 1]');
    expect(result.content).toContain('two M6 bolts');
    expect(result.warnings.join(' ')).toContain('diagrams');
    const word = await extractSource(
      'kit.docx',
      new Uint8Array(readFileSync(new URL('./fixtures/kit-instructions.docx', import.meta.url))),
    );
    expect(word.content).toContain('two M6 bolts');
    expect(word.warnings.join(' ')).toContain('figures');
  });
  it('extracts UTF-8 text and rejects unsupported, huge and invalid files', async () => {
    expect(
      (await extractSource('steps.md', new TextEncoder().encode('Step 1: Count two bolts.')))
        .content,
    ).toContain('Count two');
    await expect(extractSource('script.exe', new Uint8Array([1, 2]))).rejects.toThrow('Use PDF');
    expect(() => extractSource('large.txt', new Uint8Array(8 * 1024 * 1024 + 1))).toThrow('8 MiB');
    await expect(extractSource('bad.txt', new Uint8Array([255, 255]))).rejects.toThrow();
  });
  it('blocks local/private capture targets, including IPv4-mapped IPv6', async () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.1.5',
      '172.16.0.1',
      '169.254.169.254',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
    ])
      expect(publicAddress(ip), ip).toBe(false);
    expect(publicAddress('93.184.216.34')).toBe(true);
    await expect(fetchSource('http://127.0.0.1:4180/local/session')).rejects.toThrow();
    await expect(fetchSource('http://[::1]/')).rejects.toThrow();
    await expect(fetchSource('file:///etc/passwd')).rejects.toThrow();
  });
});
