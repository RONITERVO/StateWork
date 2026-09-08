import { describe, expect, it } from 'vitest';
import { MemoryStore, WorkError, WorkService } from '@statework/sdk';
import type { Command } from '@statework/sdk';
import * as THREE from 'three';
import {
  arcSlot,
  nextTask,
  resourceFor,
  safeResource,
  semanticNodes,
  starterSnapshot,
  starterTasks,
  stateMark,
  statusCommand,
  visibleNodes,
} from '../packages/reference/src/spatial/model';
import { pickAction } from '../packages/reference/src/spatial/scene';

const at = '2026-09-08T10:00:00.000Z';
function fixture(tasks = starterTasks) {
  const store = new MemoryStore(),
    service = new WorkService(store, () => at),
    work = service.connect('owner');
  work.import(
    starterSnapshot(
      { id: 'starter', title: 'Example studio', project: 'Example release', tasks },
      at,
    ),
    { id: 'work', title: 'Example studio' },
  );
  let request = 0;
  const execute = (commands: Command[]) =>
    work.execute('work', {
      schemaVersion: 1,
      requestId: `change-${++request}`,
      expectedRevision: work.snapshot('work').workspace.revision,
      commands,
    });
  return { store, service, work, execute };
}
describe('spatial layer preserves backend meaning', () => {
  it('imports a complete editable starter, with real prerequisites and role-aware actions', () => {
    const { work, store, execute } = fixture();
    const state = work.snapshot('work');
    expect(state.items).toHaveLength(6);
    expect(state.relations).toHaveLength(9);
    expect(state.workspace.revision).toBe(0);
    const blocked = semanticNodes(state, 'owner').find((n) => n.id === 'step-3')!;
    expect(stateMark(blocked)).toBe('waiting');
    expect(blocked.actions.find((a) => a.id === 'complete')?.enabled).toBe(false);
    expect(() =>
      execute([statusCommand(state.items.find((i) => i.id === 'step-3')!, 'done')]),
    ).toThrow(WorkError);
    expect(work.snapshot('work')).toEqual(state);
    for (const id of ['step-1', 'step-2'])
      execute([statusCommand(work.snapshot('work').items.find((i) => i.id === id)!, 'done')]);
    const updated = work.snapshot('work');
    expect(stateMark(semanticNodes(updated, 'owner').find((n) => n.id === 'step-3')!)).toBe(
      'ready',
    );
    expect(nextTask(updated, at)?.id).toBe('step-3');
    store.grant('work', 'viewer', 'reader');
    expect(
      semanticNodes(updated, 'reader').every((n) =>
        n.actions.filter((a) => a.id !== 'open').every((a) => !a.enabled),
      ),
    ).toBe(true);
    expect(work.events('work').events).toHaveLength(2);
  });
  it('does not infer dependencies from edited task names, and validates the whole starter', () => {
    const { work } = fixture(['Get access', 'Model an object']);
    expect(work.snapshot('work').relations.every((r) => r.kind === 'contains')).toBe(true);
    expect(() =>
      starterSnapshot({ id: 'bad', title: ' ', project: 'Project', tasks: ['Task'] }, at),
    ).toThrow();
    expect(() =>
      starterSnapshot(
        { id: 'bad', title: 'Title', project: 'Project', tasks: Array(9).fill('Task') },
        at,
      ),
    ).toThrow();
  });
  it('late opening suggests actionable work without mutating dates, completion or future schedules', () => {
    const { work, execute } = fixture(['First', 'Later']);
    execute([
      {
        type: 'item.update',
        id: 'step-1',
        expectedVersion: 1,
        patch: {
          schedule: {
            start: '2026-09-09T09:00:00.000Z',
            end: '2026-09-09T10:00:00.000Z',
            timeZone: 'Europe/Helsinki',
          },
          priority: 3,
        },
      },
    ]);
    execute([
      { type: 'item.update', id: 'step-2', expectedVersion: 1, patch: { dueDate: '2026-09-01' } },
    ]);
    const before = work.snapshot('work');
    expect(nextTask(before, at)?.id).toBe('step-2');
    expect(work.snapshot('work')).toEqual(before);
    expect(visibleNodes(semanticNodes(before, 'owner'), 'ready')).toHaveLength(2);
  });
  it('does not hide finished records or miss items beyond an observation page', () => {
    const { work, execute } = fixture([]);
    for (let batch = 0; batch < 6; batch++)
      execute(
        Array.from({ length: 100 }, (_, i) => ({
          type: 'item.create' as const,
          item: {
            id: `task-${batch}-${i}`,
            title: `Task ${batch}-${i}`,
            kind: 'task' as const,
            status: i === 0 ? ('done' as const) : ('ready' as const),
          },
        })),
      );
    const nodes = semanticNodes(work.snapshot('work'), 'owner');
    expect(nodes).toHaveLength(601);
    expect(visibleNodes(nodes, 'done')).toHaveLength(6);
    expect(visibleNodes(nodes, 'all', 'Task 5-99')).toHaveLength(1);
  });
  it('undo uses item versions and cannot reopen a prerequisite underneath completed work', () => {
    const { work, execute } = fixture();
    for (const id of ['step-1', 'step-2', 'step-3'])
      execute([statusCommand(work.snapshot('work').items.find((i) => i.id === id)!, 'done')]);
    expect(() =>
      execute([
        statusCommand(work.snapshot('work').items.find((i) => i.id === 'step-1')!, 'ready'),
      ]),
    ).toThrow();
    expect(visibleNodes(semanticNodes(work.snapshot('work'), 'owner'), 'done')).toHaveLength(3);
  });
});

it('accepts explicit web links only, preserving unknown metadata on the actual work item', () => {
  for (const unsafe of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///C:/secret',
    '/relative',
    'https://user:pass@example.com',
    'blob:https://example.com/id',
  ])
    expect(safeResource(unsafe)).toBeNull();
  expect(safeResource('https://example.com/a?q=1')).toBe('https://example.com/a?q=1');
  const { work, execute } = fixture();
  execute([
    {
      type: 'item.update',
      id: 'step-1',
      expectedVersion: 1,
      patch: {
        extensions: {
          'example.org/custom': { nested: ['kept'] },
          'statework.spatial/resource': { url: 'https://example.com/resource' },
        },
      },
    },
  ]);
  expect(resourceFor(work.snapshot('work').items.find((i) => i.id === 'step-1')!)).toBe(
    'https://example.com/resource',
  );
  expect(
    work.export('work').state.items.find((i) => i.id === 'step-1')?.extensions[
      'example.org/custom'
    ],
  ).toEqual({ nested: ['kept'] });
});

it('controller and desktop rays choose the nearest legal target in world space', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const near = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  const far = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  near.position.set(1, 0, -2);
  far.position.set(1, 0, -3);
  near.updateMatrixWorld();
  far.updateMatrixWorld();
  const ray = new THREE.Raycaster(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1));
  expect(
    pickAction(ray, [
      { mesh: far, action: 'select:far' },
      { mesh: near, action: 'select:near' },
    ]),
  ).toBe('select:near');
  expect(pickAction(ray, [{ mesh: far, action: 'select:far' }])).toBe('select:far');
  ray.ray.origin.x = -2;
  expect(pickAction(ray, [{ mesh: near, action: 'select:near' }])).toBeNull();
  near.geometry.dispose();
  far.geometry.dispose();
  material.dispose();
  for (let i = 0; i < 6; i++) expect(arcSlot(i, 6).z).toBeLessThan(0);
});
