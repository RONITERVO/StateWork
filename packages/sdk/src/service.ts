import {
  emptyState,
  observe,
  planWork,
  transition,
  WorkError,
  packetContext,
  latestPacket,
  packetIssues,
} from '@statework/core';
import type { CommandResult, DomainEvent, Role, WorkState } from '@statework/core';
import {
  createWorkspaceSchema,
  idSchema,
  observeSchema,
  planOptionsSchema,
  parse,
  requestSchema,
  snapshotSchema,
  validateState,
} from './schemas.js';

export interface Receipt {
  fingerprint: string;
  result: CommandResult;
}
export interface Transaction {
  state: WorkState;
  role: Role;
  receipt(actorId: string, requestId: string): Receipt | undefined;
  commit(state: WorkState, actorId: string, requestId: string, receipt: Receipt): void;
  events(after: number, limit: number): DomainEvent[];
}
/** Trusted host adapter. Implementations MUST make transact all-or-nothing and serialize writers. */
export interface WorkspaceStore {
  list(actorId: string): { id: string; title: string; revision: number; role: Role }[];
  create(state: WorkState, actorId: string): void;
  transact<T>(workspaceId: string, actorId: string, fn: (tx: Transaction) => T): T;
  close(): void;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export class WorkService {
  constructor(
    readonly store: WorkspaceStore,
    private clock: () => string = () => new Date().toISOString(),
  ) {}
  /** Actor identity comes from a trusted host connection, never command JSON. */
  connect(actorId: string): WorkConnection {
    parse(idSchema, actorId);
    return new WorkConnection(this.store, actorId, this.clock);
  }
  close(): void {
    this.store.close();
  }
}
export class WorkConnection {
  constructor(
    private store: WorkspaceStore,
    readonly actorId: string,
    private clock: () => string,
  ) {}
  list() {
    return this.store.list(this.actorId);
  }
  create(input: unknown): WorkState {
    const p = parse(createWorkspaceSchema, input);
    const state = emptyState(p.id, p.title, this.clock());
    this.store.create(state, this.actorId);
    return state;
  }
  snapshot(workspaceId: string): WorkState {
    return this.with(workspaceId, (tx) => structuredClone(tx.state));
  }
  role(workspaceId: string): Role {
    return this.with(workspaceId, (tx) => tx.role);
  }
  execute(workspaceId: string, input: unknown): CommandResult {
    const request = parse(requestSchema, input);
    const fingerprint = canonical(request);
    if (fingerprint.length > 1_000_000) throw new WorkError('LIMIT', 'Command batch exceeds 1 MB.');
    return this.with(workspaceId, (tx) => {
      if (tx.role === 'reader') throw new WorkError('FORBIDDEN', 'This connection is read-only.');
      const previous = tx.receipt(this.actorId, request.requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new WorkError('CONFLICT', 'Request ID was already used for different content.');
        return structuredClone(previous.result);
      }
      const { state, result } = transition(
        tx.state,
        request,
        { id: this.actorId, role: tx.role },
        this.clock(),
      );
      tx.commit(state, this.actorId, request.requestId, { fingerprint, result });
      return result;
    });
  }
  observe(workspaceId: string, input: unknown = {}) {
    const p = parse(observeSchema, input);
    return this.with(workspaceId, (tx) =>
      observe(tx.state, { id: this.actorId, role: tx.role }, p.query, p.offset, p.limit),
    );
  }
  plan(workspaceId: string, input: unknown) {
    const options = parse(planOptionsSchema, input);
    return this.with(workspaceId, (tx) => planWork(tx.state, options));
  }
  instructions(workspaceId: string, taskId: string) {
    parse(idSchema, taskId);
    return this.with(workspaceId, (tx) => {
      const context = packetContext(tx.state, taskId);
      const packet = latestPacket(tx.state, taskId) ?? null;
      return structuredClone({
        context,
        packet,
        issues: packet ? packetIssues(tx.state, packet) : [],
        history:
          tx.state.instructions?.packets
            .filter((p) => p.taskId === taskId)
            .map((p) => ({
              id: p.id,
              revision: p.revision,
              createdAt: p.createdAt,
              review: p.review,
            })) ?? [],
      });
    });
  }
  events(
    workspaceId: string,
    after = 0,
    limit = 100,
  ): { events: DomainEvent[]; nextCursor: number; revision: number } {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500
    )
      throw new WorkError('VALIDATION', 'Invalid event cursor or limit.');
    return this.with(workspaceId, (tx) => {
      if (after > tx.state.workspace.revision)
        throw new WorkError('CONFLICT', 'Event cursor is ahead of this workspace.');
      const events = tx.events(after, limit);
      return {
        events,
        nextCursor: events.at(-1)?.sequence ?? after,
        revision: tx.state.workspace.revision,
      };
    });
  }
  export(workspaceId: string) {
    return {
      format: 'statework.snapshot' as const,
      formatVersion: 1 as const,
      exportedAt: this.clock(),
      state: this.snapshot(workspaceId),
    };
  }
  /** Imports into a NEW workspace; never overwrites existing work or imports permissions. */
  import(input: unknown, newWorkspace: unknown): WorkState {
    const snapshot = parse(snapshotSchema, input);
    const state = validateState(snapshot.state);
    const target = parse(createWorkspaceSchema, newWorkspace);
    state.workspace = { ...target, revision: 0, createdAt: this.clock() };
    this.store.create(state, this.actorId);
    return state;
  }
  private with<T>(id: string, fn: (tx: Transaction) => T): T {
    parse(idSchema, id);
    return this.store.transact(id, this.actorId, fn);
  }
}
