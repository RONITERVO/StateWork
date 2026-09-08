import { WorkError } from '@statework/core';
import type { DomainEvent, Role, WorkState } from '@statework/core';
import type { Receipt, Transaction, WorkspaceStore } from './service.js';
interface RecordState {
  state: WorkState;
  members: Map<string, Role>;
  receipts: Map<string, Receipt>;
  events: DomainEvent[];
}
export class MemoryStore implements WorkspaceStore {
  private records = new Map<string, RecordState>();
  list(actorId: string) {
    return [...this.records.values()]
      .filter((r) => r.members.has(actorId))
      .map((r) => ({
        id: r.state.workspace.id,
        title: r.state.workspace.title,
        revision: r.state.workspace.revision,
        role: r.members.get(actorId)!,
      }));
  }
  create(state: WorkState, actorId: string): void {
    if (this.records.has(state.workspace.id))
      throw new WorkError('CONFLICT', 'Workspace ID already exists.');
    this.records.set(state.workspace.id, {
      state: structuredClone(state),
      members: new Map([[actorId, 'owner']]),
      receipts: new Map(),
      events: [],
    });
  }
  grant(workspaceId: string, actorId: string, role: Role): void {
    const r = this.records.get(workspaceId);
    if (!r) throw new WorkError('NOT_FOUND', 'Workspace does not exist.');
    r.members.set(actorId, role);
  }
  transact<T>(id: string, actorId: string, fn: (tx: Transaction) => T): T {
    const record = this.records.get(id),
      role = record?.members.get(actorId);
    if (!record || !role)
      throw new WorkError('NOT_FOUND', 'Workspace is unavailable to this connection.');
    const staged = structuredClone(record);
    const key = (actor: string, request: string) => JSON.stringify([actor, request]);
    const result = fn({
      state: staged.state,
      role,
      receipt: (actor, request) => staged.receipts.get(key(actor, request)),
      commit: (state, actor, request, receipt) => {
        staged.state = structuredClone(state);
        staged.receipts.set(key(actor, request), structuredClone(receipt));
        staged.events.push(structuredClone(receipt.result.event));
      },
      events: (after, limit) =>
        structuredClone(staged.events.filter((e) => e.sequence > after).slice(0, limit)),
    });
    this.records.set(id, staged);
    return result;
  }
  close(): void {}
}
