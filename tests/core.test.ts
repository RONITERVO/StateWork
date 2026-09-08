import { describe, it, expect } from 'vitest';
import { emptyState, transition, observe, queryItems, WorkError } from '@statework/core';
import type { Command, WorkState } from '@statework/core';
const at = '2026-09-08T08:00:00.000Z';
const actor = { id: 'person', role: 'owner' as const };
const item = (id: string, title = id): Command => ({
  type: 'item.create',
  item: { id, title, kind: 'task' },
});
function apply(state: WorkState, commands: Command[]) {
  return transition(
    state,
    {
      schemaVersion: 1,
      requestId: `r${state.workspace.revision}`,
      expectedRevision: state.workspace.revision,
      commands,
    },
    actor,
    at,
  );
}
const initial = () => emptyState('work', 'Work', at);

describe('pure work graph', () => {
  it('is deterministic and does not mutate input or retain caller-owned references', () => {
    const before = initial(),
      commands = [item('a')];
    const one = apply(before, commands),
      two = apply(before, commands);
    expect(one).toEqual(two);
    expect(before.items).toHaveLength(0);
    (commands[0] as { item: { title: string } }).item.title = 'mutated';
    expect(one.state.items[0]!.title).toBe('a');
    expect(one.result.event.commands[0]).toEqual(item('a'));
  });
  it('rolls back the whole batch on invalid relationships', () => {
    const before = initial();
    expect(() =>
      apply(before, [
        item('a'),
        {
          type: 'relation.add',
          relation: { id: 'bad', from: 'a', to: 'missing', kind: 'depends_on' },
        },
      ]),
    ).toThrow(WorkError);
    expect(before.items).toEqual([]);
    expect(before.workspace.revision).toBe(0);
  });
  it.each(['depends_on', 'contains'] as const)(
    'rejects long %s cycles in any batch order',
    (kind) => {
      const before = apply(initial(), [item('a'), item('b'), item('c')]).state;
      expect(() =>
        apply(before, [
          { type: 'relation.add', relation: { id: 'ab', from: 'a', to: 'b', kind } },
          { type: 'relation.add', relation: { id: 'bc', from: 'b', to: 'c', kind } },
          { type: 'relation.add', relation: { id: 'ca', from: 'c', to: 'a', kind } },
        ]),
      ).toThrow(/acyclic/);
      expect(before.relations).toHaveLength(0);
    },
  );
  it('preserves completion invariants, including reopening prerequisites', () => {
    let state = apply(initial(), [
      item('a'),
      item('b'),
      { type: 'relation.add', relation: { id: 'r', kind: 'depends_on', from: 'b', to: 'a' } },
    ]).state;
    expect(() =>
      apply(state, [
        { type: 'item.update', id: 'b', expectedVersion: 1, patch: { status: 'done' } },
      ]),
    ).toThrow(/prerequisites/);
    state = apply(state, [
      { type: 'item.update', id: 'b', expectedVersion: 1, patch: { status: 'done' } },
      { type: 'item.update', id: 'a', expectedVersion: 1, patch: { status: 'done' } },
    ]).state;
    expect(state.items.every((i) => i.status === 'done')).toBe(true);
    expect(() =>
      apply(state, [
        { type: 'item.update', id: 'a', expectedVersion: 2, patch: { status: 'ready' } },
      ]),
    ).toThrow(/prerequisites/);
    const a = observe(state, actor).nodes.find((n) => n.id === 'a')!;
    expect(a.actions.find((a) => a.id === 'reopen')?.enabled).toBe(false);
    state = apply(state, [
      { type: 'item.update', id: 'a', expectedVersion: 2, patch: { status: 'ready' } },
      { type: 'item.update', id: 'b', expectedVersion: 2, patch: { status: 'ready' } },
    ]).state;
    expect(state.items.every((i) => i.status === 'ready')).toBe(true);
  });
  it('does not treat archived unfinished prerequisites as complete', () => {
    const state = apply(initial(), [
      item('a'),
      item('b'),
      { type: 'item.archive', id: 'a', expectedVersion: 1, archived: true },
      { type: 'relation.add', relation: { id: 'r', kind: 'depends_on', from: 'b', to: 'a' } },
    ]).state;
    expect(queryItems(state, { actionable: true })).toEqual([]);
    expect(observe(state, actor).nodes[0]!.relationships[0]?.targetLabel).toBe('a');
  });
  it('enforces single parents, duplicate IDs, and workspace/item conflicts', () => {
    const state = apply(initial(), [
      item('a'),
      item('b'),
      item('c'),
      { type: 'relation.add', relation: { id: 'r', kind: 'contains', from: 'a', to: 'b' } },
    ]).state;
    expect(() =>
      apply(state, [
        { type: 'relation.add', relation: { id: 'r2', kind: 'contains', from: 'c', to: 'b' } },
      ]),
    ).toThrow(/one parent/);
    expect(() => apply(state, [item('a')])).toThrow(/already exists/);
    expect(() =>
      apply(state, [{ type: 'item.update', id: 'a', expectedVersion: 999, patch: { title: 'x' } }]),
    ).toThrow(/changed/);
    expect(() =>
      transition(
        state,
        { schemaVersion: 1, requestId: 'r', expectedRevision: 0, commands: [item('d')] },
        actor,
        at,
      ),
    ).toThrow(/Workspace changed/);
  });
  it('provides stable text alternatives, navigation across page boundaries and reader action restrictions', () => {
    const state = apply(initial(), [
      item('c', 'Charlie'),
      item('a', 'Alpha'),
      item('b', 'Bravo'),
    ]).state;
    const before = JSON.stringify(state);
    const obs = observe(state, { id: 'reader', role: 'reader' }, { sort: 'title' }, 1, 1);
    expect(obs.nodes[0]).toMatchObject({
      id: 'b',
      label: 'Bravo',
      navigation: { previous: 'a', next: 'c' },
    });
    expect(obs.nodes[0]!.actions.find((a) => a.id === 'complete')!.enabled).toBe(false);
    expect(obs.nextOffset).toBe(2);
    expect(JSON.stringify(state)).toBe(before);
  });
  it('filters terms, tags, due dates, schedules, parent and status without time-zone coercion', () => {
    const state = apply(initial(), [
      {
        type: 'item.create',
        item: {
          id: 'task',
          kind: 'task',
          title: 'Write a quiet draft',
          tags: ['studio'],
          dueDate: '2026-09-09',
          schedule: {
            start: '2026-09-08T09:00:00.000Z',
            end: '2026-09-08T10:00:00.000Z',
            timeZone: 'Europe/Helsinki',
          },
        },
      },
      item('other'),
    ]).state;
    expect(
      queryItems(state, {
        text: 'QUIET draft',
        tags: ['studio'],
        dueBefore: '2026-09-09',
        scheduled: true,
      }).map((i) => i.id),
    ).toEqual(['task']);
    expect(queryItems(state, { dueBefore: '2026-09-08' })).toEqual([]);
  });
  it('rejects reader mutations independently of transport', () => {
    expect(() =>
      transition(
        initial(),
        { schemaVersion: 1, requestId: 'r', expectedRevision: 0, commands: [item('a')] },
        { id: 'reader', role: 'reader' },
        at,
      ),
    ).toThrow(/read-only/);
  });
});
