import { WorkError } from '@statework/core';
import type { DomainEvent, Role, WorkState } from '@statework/core';
import type { AssetBytes, Receipt, Transaction, WorkspaceStore } from './service.js';
import { FILE_LIMIT, fileStorageLimits } from './files.js';
import type { FileStorageOptions } from './files.js';
interface RecordState {
  state: WorkState;
  members: Map<string, Role>;
  receipts: Map<string, Receipt>;
  events: DomainEvent[];
  assets: Map<string, Uint8Array>;
}
export class MemoryStore implements WorkspaceStore {
  readonly assetSupport = true as const;
  readonly fileLimits;
  private records = new Map<string, RecordState>();
  constructor(options: FileStorageOptions = {}) {
    this.fileLimits = fileStorageLimits(options);
  }
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
  create(state: WorkState, actorId: string, assets: Iterable<AssetBytes> = []): void {
    if (this.records.has(state.workspace.id))
      throw new WorkError('CONFLICT', 'Workspace ID already exists.');
    const originals = new Map<string, Uint8Array>();
    let total = 0;
    for (const asset of assets) {
      total = this.checkAsset(originals, asset.sha256, asset.bytes, total);
      originals.set(asset.sha256, new Uint8Array(asset.bytes));
    }
    this.records.set(state.workspace.id, {
      state: structuredClone(state),
      members: new Map([[actorId, 'owner']]),
      receipts: new Map(),
      events: [],
      assets: originals,
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
    // Bytes are private and immutable after insertion. Clone the map, not every blob on reads.
    const staged = {
      ...structuredClone({ ...record, assets: undefined }),
      assets: new Map(record.assets),
    };
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
      asset: (digest) => {
        const bytes = staged.assets.get(digest);
        return bytes ? new Uint8Array(bytes) : undefined;
      },
      assetSize: (digest) => staged.assets.get(digest)?.byteLength,
      assetUsage: () => ({
        bytes: [...staged.assets.values()].reduce((n, bytes) => n + bytes.byteLength, 0),
        count: staged.assets.size,
      }),
      putAsset: (digest, bytes) => {
        this.checkAsset(
          staged.assets,
          digest,
          bytes,
          [...staged.assets.values()].reduce((n, b) => n + b.byteLength, 0),
        );
        staged.assets.set(digest, new Uint8Array(bytes));
      },
    });
    this.records.set(id, staged);
    return result;
  }
  private checkAsset(
    assets: Map<string, Uint8Array>,
    digest: string,
    bytes: Uint8Array,
    total: number,
  ) {
    if (bytes.byteLength > FILE_LIMIT) throw new WorkError('LIMIT', 'File exceeds 128 MiB.');
    const next = total - (assets.get(digest)?.byteLength ?? 0) + bytes.byteLength;
    if (next > this.fileLimits.workspaceBytes)
      throw new WorkError('LIMIT', 'Workspace files exceed the configured file quota.');
    return next;
  }
  close(): void {}
}
