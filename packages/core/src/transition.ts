import { WorkError, isFinished } from './model.js';
import {
  applyInstructionCommand,
  latestPacket,
  packetIssues,
  packetResultsComplete,
} from './instructions.js';
import type { CommandRequest, CommandResult, Principal, WorkItem, WorkState } from './model.js';
const structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function blockers(state: WorkState, id: string): WorkItem[] {
  const required = new Set(
    state.relations.filter((r) => r.kind === 'depends_on' && r.from === id).map((r) => r.to),
  );
  return state.items.filter((i) => required.has(i.id) && !isFinished(i));
}

function assertAcyclic(state: WorkState, kind: 'depends_on' | 'contains'): void {
  const edges = new Map<string, string[]>();
  const degree = new Map(state.items.map((i) => [i.id, 0]));
  for (const r of state.relations.filter((r) => r.kind === kind)) {
    let outgoing = edges.get(r.from);
    if (!outgoing) {
      outgoing = [];
      edges.set(r.from, outgoing);
    }
    outgoing.push(r.to);
    degree.set(r.to, (degree.get(r.to) ?? 0) + 1);
  }
  const queue = [...degree].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    visited++;
    for (const to of edges.get(id) ?? []) {
      degree.set(to, degree.get(to)! - 1);
      if (degree.get(to) === 0) queue.push(to);
    }
  }
  if (visited !== state.items.length)
    throw new WorkError('CYCLE', `${kind} relationships must be acyclic.`);
}

/** Validated inputs only. All time and identity are supplied by the trusted host. */
export function transition(
  state: WorkState,
  request: CommandRequest,
  actor: Principal,
  at: string,
): { state: WorkState; result: CommandResult } {
  if (actor.role === 'reader') throw new WorkError('FORBIDDEN', 'This connection is read-only.');
  if (request.expectedRevision !== state.workspace.revision)
    throw new WorkError('CONFLICT', 'Workspace changed. Refresh before applying your changes.', {
      currentRevision: state.workspace.revision,
    });
  if (!request.commands.length || request.commands.length > 100)
    throw new WorkError('LIMIT', 'A batch must contain 1–100 commands.');
  const next: WorkState = structuredClone(state);
  const getItem = (id: string, version?: number) => {
    const item = next.items.find((i) => i.id === id);
    if (!item) throw new WorkError('NOT_FOUND', `Item ${id} does not exist.`);
    if (version !== undefined && version !== item.version)
      throw new WorkError('CONFLICT', `Item ${id} changed.`, { currentVersion: item.version });
    return item;
  };
  for (const command of request.commands) {
    switch (command.type) {
      case 'source.capture':
      case 'asset.register':
      case 'asset.archive':
      case 'asset.relink':
      case 'packet.confirm':
      case 'packet.save':
      case 'packet.review':
      case 'packet.check':
        applyInstructionCommand(next, command, actor, at);
        break;
      case 'item.create': {
        if (next.items.some((i) => i.id === command.item.id))
          throw new WorkError('CONFLICT', 'Item ID already exists.');
        if (next.items.length >= 10000)
          throw new WorkError('LIMIT', 'This adapter supports up to 10,000 items per workspace.');
        next.items.push({
          description: '',
          status: 'inbox',
          priority: 0,
          tags: [],
          effortMinutes: null,
          dueDate: null,
          schedule: null,
          extensions: {},
          ...structuredClone(command.item),
          archived: false,
          version: 1,
          createdAt: at,
          updatedAt: at,
        });
        break;
      }
      case 'item.update': {
        const item = getItem(command.id, command.expectedVersion);
        Object.assign(item, structuredClone(command.patch));
        item.version++;
        item.updatedAt = at;
        break;
      }
      case 'item.archive': {
        const item = getItem(command.id, command.expectedVersion);
        item.archived = command.archived;
        item.version++;
        item.updatedAt = at;
        break;
      }
      case 'relation.add': {
        const r = command.relation;
        getItem(r.from);
        getItem(r.to);
        if (r.from === r.to) throw new WorkError('CYCLE', 'An item cannot link to itself.');
        if (next.relations.length >= 30000) throw new WorkError('LIMIT', 'Too many relationships.');
        if (
          next.relations.some(
            (e) => e.id === r.id || (e.kind === r.kind && e.from === r.from && e.to === r.to),
          )
        )
          throw new WorkError('CONFLICT', 'Relationship already exists.');
        if (
          r.kind === 'contains' &&
          next.relations.some((e) => e.kind === 'contains' && e.to === r.to)
        )
          throw new WorkError(
            'CONFLICT',
            'An item can have one parent. Use references for additional connections.',
          );
        next.relations.push(structuredClone(r));
        break;
      }
      case 'relation.remove': {
        if (!next.relations.some((r) => r.id === command.id))
          throw new WorkError('NOT_FOUND', 'Relationship does not exist.');
        next.relations = next.relations.filter((r) => r.id !== command.id);
        break;
      }
      case 'view.save': {
        const index = next.views.findIndex((v) => v.id === command.view.id);
        if (command.view.query.parentId) getItem(command.view.query.parentId);
        if (index < 0) {
          if (next.views.length >= 100) throw new WorkError('LIMIT', 'At most 100 saved views.');
          next.views.push(structuredClone(command.view));
        } else next.views[index] = structuredClone(command.view);
        break;
      }
      case 'view.remove': {
        if (!next.views.some((v) => v.id === command.id))
          throw new WorkError('NOT_FOUND', 'View does not exist.');
        next.views = next.views.filter((v) => v.id !== command.id);
        break;
      }
      case 'workspace.rename':
        next.workspace.title = command.title;
        break;
    }
  }
  assertAcyclic(next, 'depends_on');
  assertAcyclic(next, 'contains');
  const unfinished = new Set(next.items.filter((i) => !isFinished(i)).map((i) => i.id));
  const blockedIds = new Set(
    next.relations
      .filter((r) => r.kind === 'depends_on' && unfinished.has(r.to))
      .map((r) => r.from),
  );
  for (const item of next.items) {
    const packet = latestPacket(next, item.id);
    if (
      item.status === 'done' &&
      state.items.find((i) => i.id === item.id)?.status !== 'done' &&
      packet &&
      (packetIssues(next, packet).length || !packetResultsComplete(next, packet))
    )
      throw new WorkError(
        'BLOCKED',
        'Review and check the work packet before completing this task.',
        { itemId: item.id, packetId: packet.id },
      );
    if (item.status === 'done' && blockedIds.has(item.id))
      throw new WorkError(
        'BLOCKED',
        `Finish or cancel prerequisites before completing ${item.title}.`,
        { itemId: item.id, blockers: blockers(next, item.id).map((i) => i.id) },
      );
  }
  next.workspace.revision++;
  const event = {
    sequence: next.workspace.revision,
    workspaceId: next.workspace.id,
    actorId: actor.id,
    at,
    requestId: request.requestId,
    commands: structuredClone(request.commands),
  };
  return { state: next, result: { revision: next.workspace.revision, event } };
}
