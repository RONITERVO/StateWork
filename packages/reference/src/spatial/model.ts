import { MemoryStore, WorkService, observe, queryItems } from '@statework/sdk';
import type { Command, Role, SemanticNode, WorkItem, WorkState } from '@statework/sdk';

export const resourceNamespace = 'statework.spatial/resource';
export type Filter = 'all' | 'ready' | 'waiting' | 'done';
export type StateMark = 'ready' | 'active' | 'waiting' | 'done' | 'cancelled';
export const marks: Record<StateMark, { symbol: string; label: string; color: string }> = {
  ready: { symbol: '○', label: 'Ready', color: '#9fc5ff' },
  active: { symbol: '▶', label: 'In progress', color: '#9fe2c7' },
  waiting: { symbol: '◇', label: 'Needs first', color: '#ffd19a' },
  done: { symbol: '✓', label: 'Done', color: '#9fe2c7' },
  cancelled: { symbol: '−', label: 'Cancelled', color: '#b1b8ca' },
};
export function stateMark(node: SemanticNode): StateMark {
  const status = node.facts.find((f) => f.key === 'status')?.value;
  if (status === 'done' || status === 'cancelled') return status;
  if (node.facts.find((f) => f.key === 'blocked')?.value) return 'waiting';
  return status === 'active' ? 'active' : 'ready';
}

/** Links are inert metadata. Never load an extension as code, markup or a remote asset. */
export function safeResource(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
export function resourceFor(item: WorkItem): string | null {
  const ext = item.extensions[resourceNamespace];
  return ext && typeof ext === 'object' && !Array.isArray(ext) ? safeResource(ext.url) : null;
}
export function semanticNodes(state: WorkState, role: Role): SemanticNode[] {
  const nodes: SemanticNode[] = [];
  for (let offset = 0; offset < state.items.length; offset += 500)
    nodes.push(...observe(state, { id: 'spatial-view', role }, {}, offset, 500).nodes);
  return nodes;
}
export function visibleNodes(nodes: SemanticNode[], filter: Filter, search = '') {
  return nodes.filter((n) => {
    const mark = stateMark(n);
    return (
      n.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
      (filter === 'all' ||
        (filter === 'ready' && ['ready', 'active'].includes(mark) && n.kind === 'task') ||
        (filter === 'waiting' && mark === 'waiting') ||
        (filter === 'done' && ['done', 'cancelled'].includes(mark)))
    );
  });
}
/** A suggestion only. Never changes dates or completion when someone starts late. */
export function nextTask(state: WorkState, now: string): WorkItem | undefined {
  return queryItems(state, { actionable: true })
    .filter((i) => !i.schedule || i.schedule.start <= now)
    .sort(
      (a, b) =>
        Number(b.status === 'active') - Number(a.status === 'active') ||
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        b.priority - a.priority ||
        a.id.localeCompare(b.id),
    )[0];
}
export function statusCommand(item: WorkItem, status: WorkItem['status']): Command {
  return { type: 'item.update', id: item.id, expectedVersion: item.version, patch: { status } };
}
export const starterTasks = [
  'Gather references',
  'Get tool access',
  'Build first pass',
  'Review the work',
  'Deliver the result',
];

/** Build and validate in memory, then import once: setup never leaves a half-created workspace. */
export function starterSnapshot(
  input: { id: string; title: string; project: string; tasks: string[] },
  at: string,
) {
  if (input.tasks.length > 8)
    throw new Error('Use up to eight starting steps. Add more inside your space.');
  const service = new WorkService(new MemoryStore(), () => at);
  const work = service.connect('starter');
  try {
    work.create({ id: input.id, title: input.title.trim() });
    const commands: Command[] = [
      {
        type: 'item.create',
        item: { id: 'project', kind: 'project', title: input.project.trim(), status: 'ready' },
      },
    ];
    input.tasks.forEach((title, i) => {
      commands.push({
        type: 'item.create',
        item: {
          id: `step-${i + 1}`,
          kind: 'task',
          title: title.trim(),
          status: 'ready',
          priority: i === 0 ? 2 : 1,
        },
      });
      commands.push({
        type: 'relation.add',
        relation: { id: `branch-${i + 1}`, kind: 'contains', from: 'project', to: `step-${i + 1}` },
      });
    });
    // Only the named example has sample prerequisites; arbitrary user text never implies a dependency.
    if (
      input.tasks.length === starterTasks.length &&
      input.tasks.every((t, i) => t === starterTasks[i])
    ) {
      [
        [3, 1],
        [3, 2],
        [4, 3],
        [5, 4],
      ].forEach(([from, to], i) =>
        commands.push({
          type: 'relation.add',
          relation: { id: `need-${i}`, kind: 'depends_on', from: `step-${from}`, to: `step-${to}` },
        }),
      );
    }
    work.execute(input.id, {
      schemaVersion: 1,
      requestId: 'starter-setup',
      expectedRevision: 0,
      commands,
    });
    return work.export(input.id);
  } finally {
    service.close();
  }
}

/** Horizontal arc, in meters relative to the viewer's chosen origin. No camera motion. */
export function arcSlot(index: number, count: number, radius = 2.5) {
  const angle = (index - (count - 1) / 2) * 0.43;
  return { x: Math.sin(angle) * radius, z: -Math.cos(angle) * radius, yaw: -angle };
}
