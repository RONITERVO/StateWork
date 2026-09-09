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
import {
  decodeFile,
  encodeFile,
  fileDigest,
  FILE_LIMIT,
  INLINE_FILE_LIMIT,
  INLINE_BUNDLE_LIMIT,
  FILE_PACKAGE_HELP,
  fileStorageLimits,
} from './files.js';
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
  filePackageSchema,
} from './schemas.js';
import type { FilePackageManifest } from './schemas.js';

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
  assetUsage?(): { bytes: number; count: number };
  putAsset?(sha256: string, bytes: Uint8Array): void;
}
export interface AssetBytes {
  sha256: string;
  bytes: Uint8Array;
}
/** Trusted synchronous host capability. digest must compute SHA-256 from the supplied bytes. */
export interface FilePackageSource {
  read(sha256: string): Uint8Array;
  digest(bytes: Uint8Array): string;
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
  readonly fileLimits?: { readonly fileBytes: number; readonly workspaceBytes: number };
  list(actorId: string): { id: string; title: string; revision: number; role: Role }[];
  /** Consume all assets before making the workspace visible; iterator failure must roll back. */
  create(state: WorkState, actorId: string, assets?: Iterable<AssetBytes>): void;
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
  storageInfo(workspaceId: string) {
    return this.with(workspaceId, (tx) => {
      const assets = tx.state.instructions?.assets ?? [];
      const unique = new Map(assets.map((a) => [a.sha256, a]));
      const available = [...unique.values()].filter((a) => tx.assetSize?.(a.sha256) === a.size);
      const usage = tx.assetUsage?.() ?? {
        bytes: available.reduce((total, a) => total + a.size, 0),
        count: available.length,
      };
      return {
        storedBytes: usage.bytes,
        storedFiles: usage.count,
        largestFileBytes: available.reduce((largest, a) => Math.max(largest, a.size), 0),
        logicalBytes: assets.reduce((total, a) => total + a.size, 0),
        assetCount: assets.length,
        uniqueFiles: unique.size,
        duplicateFiles: assets.length - unique.size,
        missingFiles: unique.size - available.length,
        limits: this.store.fileLimits ?? fileStorageLimits(),
        inlineBundle: { fileBytes: INLINE_FILE_LIMIT, totalBytes: INLINE_BUNDLE_LIMIT },
      };
    });
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
    if (content.byteLength > FILE_LIMIT) throw new WorkError('LIMIT', 'File exceeds 128 MiB.');
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
    if (content.byteLength > FILE_LIMIT) throw new WorkError('LIMIT', 'File exceeds 128 MiB.');
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
      // Check metadata before reading or encoding even the first blob.
      for (const asset of unique.values()) {
        if (tx.assetSize?.(asset.sha256) !== asset.size) continue;
        total += asset.size;
        if (asset.size > INLINE_FILE_LIMIT || total > INLINE_BUNDLE_LIMIT)
          throw new WorkError('LIMIT', FILE_PACKAGE_HELP);
      }
      for (const asset of unique.values()) {
        const bytes = tx.asset?.(asset.sha256);
        if (!bytes || bytes.byteLength !== asset.size) {
          missing.push(asset.sha256);
          continue;
        }
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
      if (total > INLINE_BUNDLE_LIMIT) throw new WorkError('LIMIT', FILE_PACKAGE_HELP);
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
  /** The synchronous consumer sees one snapshot and may read one original at a time. */
  exportFilePackage<T>(
    workspaceId: string,
    consume: (manifest: FilePackageManifest, read: (sha256: string) => Uint8Array) => T,
  ): T {
    return this.with(workspaceId, (tx) => {
      const identities = new Map(
        (tx.state.instructions?.assets ?? []).map((a) => [a.sha256, a.size]),
      );
      const files: string[] = [],
        missing: string[] = [];
      for (const [digest, size] of identities)
        (tx.assetSize?.(digest) === size ? files : missing).push(digest);
      const manifest: FilePackageManifest = {
        format: 'statework.file-package',
        formatVersion: 1,
        snapshot: {
          format: 'statework.snapshot',
          formatVersion: 1,
          exportedAt: this.clock(),
          state: structuredClone(tx.state),
        },
        files,
        missing,
      };
      const available = new Set(files);
      let active = true;
      try {
        const result = consume(manifest, (digest) => {
          if (!active || !available.has(digest))
            throw new WorkError('NOT_FOUND', 'File is unavailable to this package export.');
          const bytes = tx.asset?.(digest);
          if (!bytes || bytes.byteLength !== identities.get(digest))
            throw new WorkError('VALIDATION', 'An original file changed during package export.');
          return bytes;
        });
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          void Promise.resolve(result).catch(() => {});
          throw new WorkError('VALIDATION', 'File package consumers must complete synchronously.');
        }
        return result;
      } finally {
        active = false;
      }
    });
  }
  /** Import a validated manifest using a trusted host reader and SHA-256 implementation. */
  importFilePackage(input: unknown, newWorkspace: unknown, source: FilePackageSource): WorkState {
    const manifest = parse(filePackageSchema, input);
    const state = validateState(manifest.snapshot.state);
    const target = parse(createWorkspaceSchema, newWorkspace);
    if (!this.store.assetSupport && manifest.files.length)
      throw new WorkError('VALIDATION', 'This storage adapter cannot import original files.');
    const identities = new Map((state.instructions?.assets ?? []).map((a) => [a.sha256, a.size]));
    const declared = [...manifest.files, ...manifest.missing];
    if (
      new Set(declared).size !== declared.length ||
      declared.length !== identities.size ||
      declared.some((digest) => !identities.has(digest))
    )
      throw new WorkError(
        'VALIDATION',
        'The file manifest must account for every file identity exactly once.',
      );
    const total = manifest.files.reduce((n, digest) => n + identities.get(digest)!, 0);
    if (total > (this.store.fileLimits ?? fileStorageLimits()).workspaceBytes)
      throw new WorkError('LIMIT', 'Package files exceed the configured workspace file quota.');
    state.workspace = { ...target, revision: 0, createdAt: this.clock() };
    enforcePolicy(
      this.policy?.beforeImport
        ? () => this.policy!.beforeImport!({ state: structuredClone(state), actorId: this.actorId })
        : undefined,
    );
    function* originals(): IterableIterator<AssetBytes> {
      for (const digest of manifest.files) {
        const content = source.read(digest);
        if (
          !(content instanceof Uint8Array) ||
          content.byteLength !== identities.get(digest) ||
          content.byteLength > FILE_LIMIT
        )
          throw new WorkError('VALIDATION', 'A package file does not match its recorded size.');
        const bytes = new Uint8Array(content);
        if (source.digest(bytes) !== digest)
          throw new WorkError('VALIDATION', 'A package file does not match its recorded identity.');
        yield { sha256: digest, bytes };
      }
    }
    this.store.create(state, this.actorId, originals());
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
