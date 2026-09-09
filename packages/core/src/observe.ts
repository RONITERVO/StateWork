import { isFinished, WorkError } from './model.js';
import type { Principal, Query, Relation, WorkItem, WorkState } from './model.js';
import { latestPacket, packetIssues } from './instructions.js';

export interface SemanticNode {
  id: string;
  label: string;
  kind: WorkItem['kind'];
  summary: string;
  facts: { key: string; label: string; value: string | number | boolean }[];
  relationships: {
    id: string;
    kind: Relation['kind'];
    direction: 'outgoing' | 'incoming';
    targetId: string;
    targetLabel: string;
  }[];
  actions: {
    id: 'open' | 'complete' | 'reopen' | 'archive' | 'restore';
    label: string;
    enabled: boolean;
    reason?: string;
  }[];
  navigation: {
    previous: string | null;
    next: string | null;
    parent: string | null;
    children: string[];
    prerequisites: string[];
  };
}
export interface Observation {
  schemaVersion: 1;
  workspace: WorkState['workspace'];
  total: number;
  offset: number;
  nextOffset: number | null;
  nodes: SemanticNode[];
}
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function queryItems(state: WorkState, query: Query = {}): WorkItem[] {
  const unfinished = new Set(state.items.filter((i) => !isFinished(i)).map((i) => i.id));
  const blockedIds = new Set(
    state.relations
      .filter((r) => r.kind === 'depends_on' && unfinished.has(r.to))
      .map((r) => r.from),
  );
  const terms = (query.text ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const children = query.parentId
    ? new Set(
        state.relations
          .filter((r) => r.kind === 'contains' && r.from === query.parentId)
          .map((r) => r.to),
      )
    : null;
  const items = state.items.filter(
    (i) =>
      i.archived === (query.archived ?? false) &&
      (!query.statuses?.length || query.statuses.includes(i.status)) &&
      (!query.kinds?.length || query.kinds.includes(i.kind)) &&
      (!query.tags?.length || query.tags.every((t) => i.tags.includes(t))) &&
      (!children || children.has(i.id)) &&
      (!query.dueBefore || (!!i.dueDate && i.dueDate <= query.dueBefore)) &&
      (!query.actionable || (i.kind === 'task' && !isFinished(i) && !blockedIds.has(i.id))) &&
      (query.scheduled === undefined || Boolean(i.schedule) === query.scheduled) &&
      terms.every((t) =>
        `${i.title} ${i.description} ${i.tags.join(' ')}`.toLowerCase().includes(t),
      ),
  );
  return items.sort((a, b) => {
    let n: number;
    switch (query.sort ?? 'priority') {
      case 'title':
        n = cmp(a.title.toLowerCase(), b.title.toLowerCase());
        break;
      case 'due':
        n = cmp(a.dueDate ?? '9999-12-31', b.dueDate ?? '9999-12-31');
        break;
      case 'updated':
        n = cmp(b.updatedAt, a.updatedAt);
        break;
      default:
        n = b.priority - a.priority;
    }
    return n || cmp(a.id, b.id);
  });
}

/** A stable semantic surface; it never advances time or modifies state. */
export function observe(
  state: WorkState,
  principal: Principal,
  query: Query = {},
  offset = 0,
  limit = 100,
): Observation {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500
  )
    throw new WorkError('VALIDATION', 'Invalid observation page.');
  const ordered = queryItems(state, query);
  const byId = new Map(state.items.map((i) => [i.id, i]));
  const byEndpoint = new Map<string, Relation[]>();
  const completedDependents = new Set<string>();
  for (const edge of state.relations) {
    for (const id of [edge.from, edge.to]) {
      let list = byEndpoint.get(id);
      if (!list) {
        list = [];
        byEndpoint.set(id, list);
      }
      list.push(edge);
    }
    if (edge.kind === 'depends_on' && byId.get(edge.from)?.status === 'done')
      completedDependents.add(edge.to);
  }
  const nodes = ordered.slice(offset, offset + limit).map((item, index): SemanticNode => {
    const edges = byEndpoint.get(item.id) ?? [];
    const blocked = edges
      .filter((r) => r.kind === 'depends_on' && r.from === item.id)
      .map((r) => byId.get(r.to)!)
      .filter((i) => !isFinished(i));
    const writable = principal.role !== 'reader';
    const finished = isFinished(item);
    const packet = latestPacket(state, item.id);
    const instructionGaps = packet ? packetIssues(state, packet) : [];
    const packetPending =
      !!packet &&
      (instructionGaps.length > 0 ||
        packet.steps.some((s) => !packet.checks.some((c) => c.stepId === s.id)));
    return {
      id: item.id,
      label: item.title,
      kind: item.kind,
      summary: `${item.title}. ${item.kind}. ${item.status}.${item.dueDate ? ` Due ${item.dueDate}.` : ''}${blocked.length ? ` Waiting for ${blocked.map((i) => i.title).join(', ')}.` : ''}`,
      facts: [
        ...(packet
          ? [
              { key: 'packet.id', label: 'Work packet', value: packet.id },
              {
                key: 'packet.ready',
                label: 'Instructions reviewed and current',
                value: instructionGaps.length === 0,
              },
              {
                key: 'packet.checked',
                label: 'Instruction results checked',
                value: packet.checks.length,
              },
              { key: 'packet.steps', label: 'Instruction steps', value: packet.steps.length },
            ]
          : []),
        { key: 'status', label: 'Status', value: item.status },
        { key: 'priority', label: 'Priority', value: item.priority },
        { key: 'blocked', label: 'Waiting for prerequisites', value: blocked.length > 0 },
        { key: 'archived', label: 'Archived', value: item.archived },
        ...(item.description
          ? [{ key: 'description', label: 'Description', value: item.description }]
          : []),
        ...(item.dueDate ? [{ key: 'dueDate', label: 'Due date', value: item.dueDate }] : []),
        ...(item.schedule
          ? [
              { key: 'start', label: 'Scheduled start', value: item.schedule.start },
              { key: 'end', label: 'Scheduled end', value: item.schedule.end },
              { key: 'timeZone', label: 'Time zone', value: item.schedule.timeZone },
            ]
          : []),
        ...(item.effortMinutes !== null
          ? [{ key: 'effortMinutes', label: 'Estimated minutes', value: item.effortMinutes }]
          : []),
        ...item.tags.map((tag, i) => ({ key: `tag.${i}`, label: 'Tag', value: tag })),
      ],
      relationships: edges.map((r) => {
        const outgoing = r.from === item.id;
        const targetId = outgoing ? r.to : r.from;
        return {
          id: r.id,
          kind: r.kind,
          direction: outgoing ? 'outgoing' : 'incoming',
          targetId,
          targetLabel: byId.get(targetId)!.title,
        };
      }),
      actions: [
        { id: 'open', label: 'Open details', enabled: true },
        {
          id: finished ? 'reopen' : 'complete',
          label: finished ? 'Move to ready' : 'Mark complete',
          enabled:
            writable &&
            (finished ? !completedDependents.has(item.id) : !blocked.length && !packetPending),
          reason: !writable
            ? 'Read-only connection'
            : blocked.length && !finished
              ? 'Finish prerequisites first'
              : finished && completedDependents.has(item.id)
                ? 'Reopen completed dependents in the same batch first'
                : !finished && packetPending
                  ? 'Open the work packet; review instructions and check each result'
                  : undefined,
        },
        {
          id: item.archived ? 'restore' : 'archive',
          label: item.archived ? 'Restore' : 'Archive',
          enabled: writable,
          reason: !writable ? 'Read-only connection' : undefined,
        },
      ],
      navigation: {
        previous: ordered[offset + index - 1]?.id ?? null,
        next: ordered[offset + index + 1]?.id ?? null,
        parent: edges.find((r) => r.kind === 'contains' && r.to === item.id)?.from ?? null,
        children: edges.filter((r) => r.kind === 'contains' && r.from === item.id).map((r) => r.to),
        prerequisites: edges
          .filter((r) => r.kind === 'depends_on' && r.from === item.id)
          .map((r) => r.to),
      },
    };
  });
  return {
    schemaVersion: 1,
    workspace: { ...state.workspace },
    total: ordered.length,
    offset,
    nextOffset: offset + nodes.length < ordered.length ? offset + nodes.length : null,
    nodes,
  };
}
