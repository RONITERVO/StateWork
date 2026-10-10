import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  WorkService,
  blankPacket,
  parse,
  workBriefSchema,
  workStepSchema,
  sourceReadResultSchema,
  calendarComparisonResultSchema,
  validateState,
  sourceFreshness,
} from '@statework/sdk';
import type { Command, CalendarIntent, FactInput } from '@statework/sdk';
import { createServer } from '@statework/server';
function fixture() {
  const now = '2026-10-10T12:00:00.000Z';
  const store = new MemoryStore(),
    service = new WorkService(store, () => now),
    c = service.connect('owner');
  c.create({ id: 'w', title: 'Work' });
  let serial = 0;
  const run = (commands: Command[]) =>
    c.execute('w', {
      schemaVersion: 1,
      requestId: `r${++serial}`,
      expectedRevision: c.snapshot('w').workspace.revision,
      commands,
    });
  run([
    { type: 'item.create', item: { id: 'course', title: 'Course', kind: 'project' } },
    { type: 'item.create', item: { id: 'task', title: 'Prepare CV', kind: 'task' } },
    {
      type: 'relation.add',
      relation: { id: 'parent', from: 'course', to: 'task', kind: 'contains' },
    },
  ]);
  const content = 'Use the current education. ' + 'Original exact text 🙂. '.repeat(4000);
  run([
    {
      type: 'source.capture',
      source: {
        id: 'spec',
        taskIds: ['task'],
        title: 'CV specification',
        kind: 'page',
        locator: 'https://example.com/course/42',
        content,
        coverage: 'complete',
        replaces: null,
      },
    },
    {
      type: 'source.capture',
      source: {
        id: 'shared',
        taskIds: ['course'],
        title: 'Shared historical reference',
        kind: 'note',
        locator: 'Author note',
        content: 'Shared reading.',
        coverage: 'complete',
        replaces: null,
      },
    },
  ]);
  const packet = blankPacket(c.snapshot('w'), 'task', 'p');
  packet.sourceIds = ['spec'];
  packet.questions = [];
  packet.outcome = 'Updated CV';
  packet.finish = 'Compare education and save.';
  packet.steps = [0, 1, 2].map((n) => ({
    id: `s${n}`,
    title: `Action ${n}`,
    instruction: 'Use the current education.',
    expected: 'Education is present.',
    ifBlocked: 'Read the original.',
    minutes: 5,
    actionUrl: '',
    requires: [],
    citations: [{ sourceId: 'spec', quote: 'Use the current education.', location: 'Start' }],
  }));
  run([
    { type: 'packet.save', packet, expectedPacketId: null },
    { type: 'packet.review', id: 'p' },
  ]);
  const fact = (id = 'f', kind: FactInput['kind'] = 'submitted'): FactInput => ({
    id,
    itemId: 'task',
    key: 'cv',
    kind,
    value: 'yes',
    occurredAt: now,
    sourceIds: ['spec'],
    replaces: null,
  });
  const event: CalendarIntent = {
    title: 'CV workshop',
    actionUrl: 'https://example.com/join',
    schedule: {
      start: '2026-10-20T06:00:00.000Z',
      end: '2026-10-20T08:00:00.000Z',
      timeZone: 'Europe/Helsinki',
    },
    dueDate: null,
    recurrence: [],
  };
  const bind = () =>
    run([
      {
        type: 'calendar.record',
        binding: {
          id: 'calendar',
          itemId: 'task',
          provider: 'google',
          calendarId: 'private-calendar',
          eventId: 'remote-id',
          remoteVersion: 'v1',
          observedAt: now,
          sourceIds: ['spec'],
          baseline: event,
          stopWhen: { itemId: 'task', kind: 'accepted', key: 'cv', value: 'yes' },
        },
      },
    ]);
  return { now, store, service, c, run, content, fact, event, bind };
}
describe('compact work retrieval', () => {
  it('starts with a small derived brief and loads exact steps and text on demand without mutations', () => {
    const { c, content } = fixture(),
      before = c.snapshot('w');
    const b = parse(workBriefSchema, c.brief('w', { taskId: 'task' }));
    expect(b.next?.stepId).toBe('s0');
    expect(b.counts.sources).toBe(1);
    expect(b.counts.historical).toBe(1);
    expect(JSON.stringify(b).length).toBeLessThan(2500);
    expect(JSON.stringify(b)).not.toContain(content);
    const step = parse(
      workStepSchema,
      c.step('w', 'task', 's0', { expectedRevision: b.workspace.revision }),
    );
    expect(step.step.instruction).toBe('Use the current education.');
    expect(step.sources.map((s) => s.id)).toEqual(['spec']);
    let rebuilt = '',
      offset = 0;
    do {
      const part = parse(
        sourceReadResultSchema,
        c.sourceRead('w', 'spec', { offset, limit: 4000 }),
      );
      rebuilt += part.content;
      if (part.nextOffset === null) break;
      offset = part.nextOffset;
    } while (true);
    expect(rebuilt).toBe(content);
    expect(c.snapshot('w')).toEqual(before);
  });
  it('finds work by source URL, pages all rows and makes inherited sources explicit', () => {
    const { c } = fixture();
    expect(c.brief('w', { text: 'https://example.com/course/42' }).entries[0]?.id).toBe('task');
    const b = c.brief('w', { taskId: 'task', section: 'steps', limit: 2 });
    expect(b.nextOffset).toBe(2);
    expect(
      c
        .brief('w', { taskId: 'task', section: 'steps', offset: 2, limit: 2 })
        .entries.map((e) => e.id),
    ).toEqual(['s2']);
    expect(
      c
        .brief('w', { taskId: 'task', section: 'sources', includeInherited: true })
        .entries.map((e) => e.id),
    ).toContain('shared');
    expect(c.brief('w', { taskId: 'course' }).next?.taskId).toBe('task');
  });
  it('rejects stale pages, oversized reads and unauthorized work; returned values cannot mutate state', () => {
    const { c, run, service, store } = fixture();
    const b = c.brief('w');
    run([{ type: 'workspace.rename', title: 'Changed' }]);
    expect(() => c.brief('w', { expectedRevision: b.workspace.revision })).toThrow(/Refresh/);
    expect(() => c.step('w', 'task', 's0', { expectedRevision: b.workspace.revision })).toThrow(
      /Refresh/,
    );
    expect(() => c.sourceRead('w', 'spec', { limit: 16001 })).toThrow();
    expect(() => service.connect('stranger').brief('w')).toThrow();
    store.grant('w', 'reader', 'reader');
    expect(service.connect('reader').brief('w').total).toBe(2);
    const step = c.step('w', 'task', 's0');
    step.step.instruction = 'Tamper';
    expect(c.step('w', 'task', 's0').step.instruction).not.toBe('Tamper');
  });
  it('reports missing procedures rather than showing an empty green state', () => {
    const { c, run } = fixture();
    run([{ type: 'item.create', item: { id: 'new', title: 'Unmapped work', kind: 'task' } }]);
    const b = c.brief('w', { taskId: 'new' });
    expect(b.counts.blockers).toBe(1);
    expect(b.next).toBeNull();
  });
});
describe('evidence and separate progress facts', () => {
  it('expires currency without rewriting evidence and exposes checks for safe resumption', () => {
    const { c, run, now } = fixture();
    run([
      {
        type: 'source.verify',
        verification: {
          id: 'v',
          sourceId: 'spec',
          observedAt: now,
          validUntil: '2026-10-11T12:00:00.000Z',
          result: 'unchanged',
          evidence: 'Compared original.',
        },
      },
      {
        type: 'packet.check',
        id: 'p',
        stepId: 's0',
        checked: true,
        evidence: 'Compared the saved output.',
      },
    ]);
    const state = c.snapshot('w');
    expect(sourceFreshness(state, 'spec', '2026-10-11T12:00:00.000Z').status).toBe('needs-check');
    expect(c.step('w', 'task', 's0').check?.evidence).toBe('Compared the saved output.');
    expect(c.brief('w', { taskId: 'task' }).next?.stepId).toBe('s1');
  });
  it('does not infer completion or acceptance; corrections preserve the full fact history', () => {
    const { c, run, fact } = fixture();
    run([{ type: 'fact.record', fact: fact() }]);
    expect(c.snapshot('w').items.find((i) => i.id === 'task')?.status).toBe('inbox');
    expect(c.brief('w', { taskId: 'task', section: 'facts' }).entries.map((e) => e.kind)).toEqual([
      'submitted',
    ]);
    expect(() => run([{ type: 'fact.record', fact: fact('duplicate') }])).toThrow();
    run([
      { type: 'fact.record', fact: { ...fact('corrected'), value: 'withdrawn', replaces: 'f' } },
    ]);
    expect(c.brief('w', { taskId: 'task', section: 'facts' }).entries[0]?.detail).toBe('withdrawn');
    expect(c.snapshot('w').knowledge?.facts).toHaveLength(2);
    expect(c.record('w', 'facts', 'f').record.id).toBe('f');
    expect(validateState(c.snapshot('w'))).toEqual(c.snapshot('w'));
    c.import(c.export('w'), { id: 'restored', title: 'Restored' });
    expect(c.record('restored', 'facts', 'f').record.id).toBe('f');
  });
  it('rejects future facts, unrelated corrections and missing evidence atomically', () => {
    const { c, run, fact } = fixture();
    const before = c.snapshot('w');
    expect(() =>
      run([
        { type: 'workspace.rename', title: 'Should roll back' },
        { type: 'fact.record', fact: { ...fact(), sourceIds: ['missing'] } },
      ]),
    ).toThrow();
    expect(c.snapshot('w')).toEqual(before);
    expect(() =>
      run([{ type: 'fact.record', fact: { ...fact(), occurredAt: '2027-01-01T00:00:00.000Z' } }]),
    ).toThrow();
    run([{ type: 'fact.record', fact: fact() }]);
    expect(() =>
      run([{ type: 'fact.record', fact: { ...fact('x', 'accepted'), replaces: 'f' } }]),
    ).toThrow();
    const invalid = c.snapshot('w');
    invalid.knowledge!.facts[0]!.sourceIds = ['missing'];
    expect(() => validateState(invalid)).toThrow();
  });
  it('keeps capture time separate from verification and blocks known changed sources', () => {
    const { c, run, now } = fixture();
    expect(c.sourceRead('w', 'spec').freshness.status).toBe('historical');
    run([
      {
        type: 'source.verify',
        verification: {
          id: 'v1',
          sourceId: 'spec',
          observedAt: now,
          validUntil: '2026-10-11T12:00:00.000Z',
          result: 'unchanged',
          evidence: 'Compared current original.',
        },
      },
    ]);
    expect(c.sourceRead('w', 'spec').freshness.status).toBe('verified');
    run([
      {
        type: 'source.verify',
        verification: {
          id: 'v2',
          sourceId: 'spec',
          observedAt: now,
          validUntil: '2026-10-11T12:00:00.000Z',
          result: 'changed',
          evidence: 'Original has a new deadline.',
        },
      },
    ]);
    expect(c.brief('w', { taskId: 'task' }).next).toBeNull();
    expect(c.sourceRead('w', 'spec').freshness.status).toBe('needs-check');
  });
  it('relinks captures without altering originals or deleting historical citations', () => {
    const { c, run, content } = fixture();
    run([
      {
        type: 'source.relink',
        id: 'spec',
        taskIds: ['course'],
        reason: 'Shared course instructions.',
      },
    ]);
    expect(c.source('w', 'spec').content).toBe(content);
    expect(c.step('w', 'task', 's0').sources.map((s) => s.id)).toContain('spec');
    expect(c.events('w').events.at(-1)?.commands[0]?.type).toBe('source.relink');
  });
});
describe('calendar reconciliation', () => {
  it('rejects duplicate remote identities and distinguishes recurring stop proposals', () => {
    const { c, run, bind, fact, event, now } = fixture();
    bind();
    const {
      recordedAt: _at,
      recordedBy: _by,
      ...binding
    } = c.snapshot('w').knowledge!.calendars[0]!;
    expect(() =>
      run([{ type: 'calendar.record', binding: { ...binding, id: 'duplicate' } }]),
    ).toThrow(/duplicate/);
    const recurring = { ...event, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=FR'] };
    run([
      { type: 'calendar.record', binding: { ...binding, baseline: recurring } },
      { type: 'fact.record', fact: fact('accepted', 'accepted') },
    ]);
    expect(
      c.calendarCompare('w', {
        bindingId: 'calendar',
        desired: recurring,
        observed: { event: recurring, version: 'v3', observedAt: now },
      }).action,
    ).toBe('stop-series');
  });
  it('distinguishes local, remote and simultaneous edits without writes', () => {
    const { c, bind, event, now } = fixture();
    bind();
    const before = c.snapshot('w');
    const compare = (desired = event, remote: CalendarIntent | null = event) =>
      parse(
        calendarComparisonResultSchema,
        c.calendarCompare('w', {
          bindingId: 'calendar',
          desired,
          observed: { event: remote, version: 'v2', observedAt: now },
        }),
      );
    expect(compare().action).toBe('in-sync');
    expect(compare({ ...event, title: 'Local' }).action).toBe('update-remote');
    expect(compare(event, { ...event, title: 'Remote' }).action).toBe('review-remote');
    expect(compare({ ...event, title: 'Local' }, { ...event, title: 'Remote' }).action).toBe(
      'conflict',
    );
    expect(compare(event, null).action).toBe('remote-missing');
    expect(compare().externalActionsAuthorized).toBe(false);
    expect(c.snapshot('w')).toEqual(before);
  });
  it('stops only on the exact recorded fact and requires fresh provider observations', () => {
    const { c, run, bind, event, now, fact } = fixture();
    bind();
    run([{ type: 'fact.record', fact: fact() }]);
    const input = {
      bindingId: 'calendar',
      desired: event,
      observed: { event, version: 'v2', observedAt: now },
    };
    expect(c.calendarCompare('w', input).action).toBe('in-sync');
    run([{ type: 'fact.record', fact: fact('accepted', 'accepted') }]);
    expect(c.calendarCompare('w', input).action).toBe('cancel-event');
    expect(
      c.calendarCompare('w', {
        ...input,
        observed: { ...input.observed, event: { ...event, title: 'Remote change' } },
      }).action,
    ).toBe('conflict');
    expect(() =>
      c.calendarCompare('w', {
        ...input,
        observed: { ...input.observed, observedAt: '2026-10-01T00:00:00.000Z' },
      }),
    ).toThrow();
  });
});
it('serves compact authenticated HTTP contracts and leaves old handoffs available', async () => {
  const { service, store, c } = fixture();
  store.grant('w', 'reader', 'reader');
  const app = await createServer({
    service,
    authenticate: (t) => (t === 'reader' ? 'reader' : undefined),
  });
  const headers = { host: '127.0.0.1:4180', authorization: 'Bearer reader' };
  try {
    for (const [url, payload, schema] of [
      ['/v1/workspaces/w/brief', { taskId: 'task' }, workBriefSchema],
      ['/v1/workspaces/w/instructions/task/steps/s0', {}, workStepSchema],
      ['/v1/workspaces/w/sources/spec/read', { limit: 200 }, sourceReadResultSchema],
    ] as const) {
      const r = await app.inject({ method: 'POST', url, headers, payload });
      expect(r.statusCode).toBe(200);
      expect(schema.safeParse(r.json()).success).toBe(true);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/workspaces/w/brief',
          headers,
          payload: { limit: 21 },
        })
      ).statusCode,
    ).toBe(400);
    expect(c.handoff('w', 'task').packet?.id).toBe('p');
  } finally {
    await app.close();
  }
});
