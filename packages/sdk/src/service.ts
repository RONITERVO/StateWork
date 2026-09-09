import {
  emptyState,
  observe,
  planWork,
  transition,
  WorkError,
  packetContext,
  latestPacket,
  packetIssues,
  workerHandoff,
  executionReadiness,
  requiredStepAssets,
} from '@statework/core';
import type {
  CommandResult,
  DomainEvent,
  Role,
  WorkState,
  CommandRequest,
  Principal,
} from '@statework/core';
import type { AssetInput } from '@statework/core';
import { assetInputSchema, workerEnvironmentSchema } from './instruction-schemas.js';
import { decodeFile, encodeFile, fileDigest, WORKSPACE_FILE_LIMIT } from './files.js';
import {
  createWorkspaceSchema,
  idSchema,
  observeSchema,
  planOptionsSchema,
  parse,
  requestSchema,
  snapshotSchema,
  validateState,
  fileBundleSchema,
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
  /** Optional file capability. Implementations return copies and commit bytes atomically. */
  asset?(sha256: string): Uint8Array | undefined;
  assetSize?(sha256: string): number | undefined;
  putAsset?(sha256: string, bytes: Uint8Array): void;
}
export interface AssetBytes {
  sha256: string;
  bytes: Uint8Array;
}
/** Trusted host rules, never code loaded from workspace data. Hooks are synchronous. */
export interface WorkPolicy {
  beforeExecute?(context: { state: WorkState; request: CommandRequest; actor: Principal }): void;
  beforeImport?(context: { state: WorkState; actorId: string }): void;
}
function enforcePolicy(fn: (() => unknown) | undefined): void {
  const result = fn?.();
  if (result && typeof (result as { then?: unknown }).then === 'function') {
    // Do not let accidental async hooks become an authorization bypass or an unhandled rejection.
    void Promise.resolve(result).catch(() => {});
    throw new WorkError('VALIDATION', 'Host policy hooks must complete synchronously.');
  }
}
/** Trusted host adapter. Implementations MUST make transact all-or-nothing and serialize writers. */
export interface WorkspaceStore {
  readonly assetSupport?: true;
  list(actorId: string): { id: string; title: string; revision: number; role: Role }[];
  create(state: WorkState, actorId: string, assets?: AssetBytes[]): void;
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
    private policy?: WorkPolicy,
  ) {}
  /** Actor identity comes from a trusted host connection, never command JSON. */
  connect(actorId: string): WorkConnection {
    parse(idSchema, actorId);
    return new WorkConnection(this.store, actorId, this.clock, this.policy);
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
    private policy?: WorkPolicy,
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
  assetManifest(workspaceId: string) {
    return this.with(workspaceId, (tx) =>
      (tx.state.instructions?.assets ?? []).map((a) => ({
        ...structuredClone(a),
        available: tx.assetSize?.(a.sha256) === a.size,
      })),
    );
  }
  handoff(workspaceId: string, taskId: string, input: unknown = {}) {
    parse(idSchema, taskId);
    const environment = parse(workerEnvironmentSchema, input);
    return this.with(workspaceId, (tx) =>
      workerHandoff(
        tx.state,
        { id: this.actorId, role: tx.role },
        {
          externalAccess: environment.externalAccess ?? false,
          availableAssetIds: (tx.state.instructions?.assets ?? [])
            .filter(
              (a) =>
                tx.assetSize?.(a.sha256) === a.size &&
                (!environment.availableAssetIds || environment.availableAssetIds.includes(a.id)),
            )
            .map((a) => a.id),
        },
      )(taskId),
    );
  }
  source(workspaceId: string, sourceId: string) {
    parse(idSchema, sourceId);
    return this.with(workspaceId, (tx) => {
      const source = tx.state.instructions?.sources.find((s) => s.id === sourceId);
      if (!source) throw new WorkError('NOT_FOUND', 'Source is unavailable to this workspace.');
      return structuredClone(source);
    });
  }
  asset(workspaceId: string, assetId: string) {
    parse(idSchema, assetId);
    return this.with(workspaceId, (tx) => {
      const asset = tx.state.instructions?.assets?.find((a) => a.id === assetId);
      if (!asset) throw new WorkError('NOT_FOUND', 'File is unavailable to this workspace.');
      const bytes = tx.asset?.(asset.sha256);
      if (!bytes || bytes.byteLength !== asset.size)
        throw new WorkError(
          'NOT_FOUND',
          'File metadata exists, but its original bytes need restoring.',
        );
      return { asset: structuredClone(asset), bytes: new Uint8Array(bytes) };
    });
  }
  async attach(
    workspaceId: string,
    input: {
      requestId: string;
      expectedRevision: number;
      asset: Omit<AssetInput, 'size' | 'sha256'>;
    },
    content: Uint8Array,
  ) {
    if (content.byteLength > 64 * 1024 * 1024) throw new WorkError('LIMIT', 'File exceeds 64 MiB.');
    if (!this.store.assetSupport)
      throw new WorkError('VALIDATION', 'This storage adapter does not support original files.');
    // Copy before the asynchronous digest so caller mutations cannot change committed bytes.
    const bytes = new Uint8Array(content);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
      n.toString(16).padStart(2, '0'),
    ).join('');
    const asset = parse(assetInputSchema, { ...input.asset, size: bytes.byteLength, sha256 });
    const request = parse(requestSchema, {
      schemaVersion: 1,
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      commands: [{ type: 'asset.register', asset }],
    });
    const fingerprint = canonical(request);
    return this.with(workspaceId, (tx) => {
      if (tx.role === 'reader') throw new WorkError('FORBIDDEN', 'This connection is read-only.');
      if (!tx.putAsset) throw new WorkError('VALIDATION', 'File storage is unavailable.');
      const previous = tx.receipt(this.actorId, request.requestId);
      enforcePolicy(
        this.policy?.beforeExecute
          ? () =>
              this.policy!.beforeExecute!({
                state: structuredClone(tx.state),
                request: structuredClone(request),
                actor: { id: this.actorId, role: tx.role },
              })
          : undefined,
      );
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
      tx.putAsset(sha256, bytes);
      tx.commit(state, this.actorId, request.requestId, { fingerprint, result });
      return result;
    });
  }
  /** Restore exact bytes for an existing immutable identity. No new approval or result is implied. */
  async restoreAsset(workspaceId: string, assetId: string, content: Uint8Array) {
    parse(idSchema, assetId);
    if (content.byteLength > 64 * 1024 * 1024) throw new WorkError('LIMIT', 'File exceeds 64 MiB.');
    const bytes = new Uint8Array(content);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
      n.toString(16).padStart(2, '0'),
    ).join('');
    return this.with(workspaceId, (tx) => {
      if (tx.role === 'reader') throw new WorkError('FORBIDDEN', 'This connection is read-only.');
      const asset = tx.state.instructions?.assets?.find((a) => a.id === assetId);
      if (!asset || digest !== asset.sha256 || bytes.byteLength !== asset.size)
        throw new WorkError('VALIDATION', 'These bytes do not match the original file identity.');
      if (!tx.putAsset) throw new WorkError('VALIDATION', 'File storage is unavailable.');
      tx.putAsset(digest, bytes);
      return { id: assetId, sha256: digest, available: true as const };
    });
  }
  execute(workspaceId: string, input: unknown): CommandResult {
    const request = parse(requestSchema, input);
    const fingerprint = canonical(request);
    if (fingerprint.length > 1_000_000) throw new WorkError('LIMIT', 'Command batch exceeds 1 MB.');
    return this.with(workspaceId, (tx) => {
      if (tx.role === 'reader') throw new WorkError('FORBIDDEN', 'This connection is read-only.');
      const previous = tx.receipt(this.actorId, request.requestId);
      enforcePolicy(
        this.policy?.beforeExecute
          ? () =>
              this.policy!.beforeExecute!({
                state: structuredClone(tx.state),
                request: structuredClone(request),
                actor: { id: this.actorId, role: tx.role },
              })
          : undefined,
      );
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
      // A metadata-only import is a useful map, but missing files cannot pass result gates.
      for (const command of request.commands) {
        const packet =
          command.type === 'packet.check' && command.checked
            ? state.instructions?.packets.find((p) => p.id === command.id)
            : command.type === 'item.update' && command.patch.status === 'done'
              ? latestPacket(state, command.id)
              : undefined;
        if (!packet?.execution) continue;
        const assetIds = new Set<string>();
        const skipped = new Set(
          executionReadiness(state, packet, this.actorId, [])
            .filter((s) => s.status === 'skipped')
            .map((s) => s.id),
        );
        for (const step of packet.steps) {
          if (skipped.has(step.id)) continue;
          if (command.type === 'packet.check' && step.id !== command.stepId) continue;
          for (const id of requiredStepAssets(packet, step.id)) assetIds.add(id);
        }
        for (const id of assetIds) {
          const asset = state.instructions?.assets?.find((a) => a.id === id);
          if (!asset || tx.assetSize?.(asset.sha256) !== asset.size)
            throw new WorkError(
              'BLOCKED',
              'Restore the required original or result file before checking work.',
              { assetId: id },
            );
        }
      }
      tx.commit(state, this.actorId, request.requestId, { fingerprint, result });
      return result;
    });
  }
  observe(workspaceId: string, input: unknown = {}) {
    const p = parse(observeSchema, input);
    return this.with(workspaceId, (tx) =>
      observe(tx.state, { id: this.actorId, role: tx.role }, p.query, p.offset, p.limit, {
        availableAssetIds: this.availableAssets(tx),
      }),
    );
  }
  plan(workspaceId: string, input: unknown) {
    const options = parse(planOptionsSchema, input);
    return this.with(workspaceId, (tx) =>
      planWork(tx.state, options, {
        actorId: this.actorId,
        environment: { availableAssetIds: this.availableAssets(tx) },
      }),
    );
  }
  private availableAssets(tx: Transaction): string[] {
    return (tx.state.instructions?.assets ?? [])
      .filter((asset) => tx.assetSize?.(asset.sha256) === asset.size)
      .map((asset) => asset.id);
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
  /** Complete portable transfer, including an explicit list of unavailable file identities. */
  exportBundle(workspaceId: string) {
    return this.with(workspaceId, (tx) => {
      const files: { sha256: string; base64: string }[] = [],
        missing: string[] = [];
      const unique = new Map((tx.state.instructions?.assets ?? []).map((a) => [a.sha256, a]));
      let total = 0;
      for (const asset of unique.values()) {
        const bytes = tx.asset?.(asset.sha256);
        if (!bytes || bytes.byteLength !== asset.size) {
          missing.push(asset.sha256);
          continue;
        }
        total += bytes.byteLength;
        if (total > WORKSPACE_FILE_LIMIT)
          throw new WorkError('LIMIT', 'Portable files exceed 256 MiB.');
        files.push({ sha256: asset.sha256, base64: encodeFile(bytes) });
      }
      return {
        format: 'statework.bundle' as const,
        formatVersion: 1 as const,
        snapshot: {
          format: 'statework.snapshot' as const,
          formatVersion: 1 as const,
          exportedAt: this.clock(),
          state: structuredClone(tx.state),
        },
        files,
        missing,
      };
    });
  }
  async importBundle(input: unknown, newWorkspace: unknown): Promise<WorkState> {
    const bundle = parse(fileBundleSchema, input);
    const state = validateState(bundle.snapshot.state);
    const target = parse(createWorkspaceSchema, newWorkspace);
    if (!this.store.assetSupport && bundle.files.length)
      throw new WorkError('VALIDATION', 'This storage adapter cannot import original files.');
    const identities = new Map((state.instructions?.assets ?? []).map((a) => [a.sha256, a.size]));
    const declared = [...bundle.files.map((f) => f.sha256), ...bundle.missing];
    if (
      new Set(declared).size !== declared.length ||
      declared.length !== identities.size ||
      declared.some((id) => !identities.has(id))
    )
      throw new WorkError(
        'VALIDATION',
        'The file manifest must account for every file identity exactly once.',
      );
    let total = 0;
    for (const file of bundle.files) {
      total +=
        Math.floor(file.base64.length / 4) * 3 -
        (file.base64.endsWith('==') ? 2 : file.base64.endsWith('=') ? 1 : 0);
      if (total > WORKSPACE_FILE_LIMIT)
        throw new WorkError('LIMIT', 'Portable files exceed 256 MiB.');
    }
    const assets: AssetBytes[] = [];
    for (const file of bundle.files) {
      const bytes = decodeFile(file.base64);
      if (
        bytes.byteLength !== identities.get(file.sha256) ||
        (await fileDigest(bytes)) !== file.sha256
      )
        throw new WorkError('VALIDATION', 'A portable file does not match its recorded identity.');
      assets.push({ sha256: file.sha256, bytes });
    }
    state.workspace = { ...target, revision: 0, createdAt: this.clock() };
    enforcePolicy(
      this.policy?.beforeImport
        ? () => this.policy!.beforeImport!({ state: structuredClone(state), actorId: this.actorId })
        : undefined,
    );
    this.store.create(state, this.actorId, assets);
    return state;
  }
  /** Imports into a NEW workspace; never overwrites existing work or imports permissions. */
  import(input: unknown, newWorkspace: unknown): WorkState {
    const snapshot = parse(snapshotSchema, input);
    const state = validateState(snapshot.state);
    const target = parse(createWorkspaceSchema, newWorkspace);
    state.workspace = { ...target, revision: 0, createdAt: this.clock() };
    enforcePolicy(
      this.policy?.beforeImport
        ? () => this.policy!.beforeImport!({ state: structuredClone(state), actorId: this.actorId })
        : undefined,
    );
    this.store.create(state, this.actorId);
    return state;
  }
  private with<T>(id: string, fn: (tx: Transaction) => T): T {
    parse(idSchema, id);
    return this.store.transact(id, this.actorId, fn);
  }
}
