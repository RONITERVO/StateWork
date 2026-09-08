import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { WorkError } from '@statework/core';
import type { DomainEvent, Role, WorkState } from '@statework/core';
import type { Receipt, Transaction, WorkspaceStore } from '@statework/sdk';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export class SqliteStore implements WorkspaceStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;',
    );
    const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version > 1) {
      this.db.close();
      throw new WorkError('VALIDATION', 'Database was created by a newer StateWork version.');
    }
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, title TEXT NOT NULL, revision INTEGER NOT NULL, snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members(workspace_id TEXT NOT NULL REFERENCES workspaces(id), actor_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','editor','reader')), PRIMARY KEY(workspace_id,actor_id));
      CREATE TABLE IF NOT EXISTS receipts(workspace_id TEXT NOT NULL REFERENCES workspaces(id), actor_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(workspace_id,actor_id,request_id));
      CREATE TABLE IF NOT EXISTS events(workspace_id TEXT NOT NULL REFERENCES workspaces(id), sequence INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(workspace_id,sequence));
      CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY, actor_id TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL);
      PRAGMA user_version = 1;
      COMMIT;`);
  }
  list(actorId: string) {
    return this.db
      .prepare(
        'SELECT w.id,w.title,w.revision,m.role FROM workspaces w JOIN members m ON m.workspace_id=w.id WHERE m.actor_id=? ORDER BY w.id',
      )
      .all(actorId) as { id: string; title: string; revision: number; role: Role }[];
  }
  create(state: WorkState, actorId: string): void {
    this.transaction(() => {
      if (this.db.prepare('SELECT id FROM workspaces WHERE id=?').get(state.workspace.id))
        throw new WorkError('CONFLICT', 'Workspace ID already exists.');
      this.db
        .prepare('INSERT INTO workspaces VALUES(?,?,?,?)')
        .run(
          state.workspace.id,
          state.workspace.title,
          state.workspace.revision,
          JSON.stringify(state),
        );
      this.db
        .prepare('INSERT INTO members VALUES(?,?,?)')
        .run(state.workspace.id, actorId, 'owner');
    });
  }
  /** Trusted provisioning API, deliberately not exposed through untrusted command JSON. */
  grant(workspaceId: string, actorId: string, role: Role): void {
    if (!this.db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspaceId))
      throw new WorkError('NOT_FOUND', 'Workspace does not exist.');
    this.db
      .prepare(
        'INSERT INTO members VALUES(?,?,?) ON CONFLICT(workspace_id,actor_id) DO UPDATE SET role=excluded.role',
      )
      .run(workspaceId, actorId, role);
  }
  transact<T>(workspaceId: string, actorId: string, fn: (tx: Transaction) => T): T {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          'SELECT w.snapshot,m.role FROM workspaces w JOIN members m ON m.workspace_id=w.id WHERE w.id=? AND m.actor_id=?',
        )
        .get(workspaceId, actorId) as { snapshot: string; role: Role } | undefined;
      if (!row) throw new WorkError('NOT_FOUND', 'Workspace is unavailable to this connection.');
      const state = JSON.parse(row.snapshot) as WorkState;
      return fn({
        state,
        role: row.role,
        receipt: (actorId, requestId) => {
          const receipt = this.db
            .prepare(
              'SELECT fingerprint,result FROM receipts WHERE workspace_id=? AND actor_id=? AND request_id=?',
            )
            .get(workspaceId, actorId, requestId) as
            | { fingerprint: string; result: string }
            | undefined;
          return receipt
            ? { fingerprint: receipt.fingerprint, result: JSON.parse(receipt.result) }
            : undefined;
        },
        commit: (next, actor, request, receipt: Receipt) => {
          if (
            next.workspace.id !== workspaceId ||
            next.workspace.revision !== state.workspace.revision + 1
          )
            throw new WorkError('CONFLICT', 'Invalid transaction revision.');
          this.db
            .prepare('UPDATE workspaces SET title=?,revision=?,snapshot=? WHERE id=?')
            .run(next.workspace.title, next.workspace.revision, JSON.stringify(next), workspaceId);
          this.db
            .prepare('INSERT INTO receipts VALUES(?,?,?,?,?)')
            .run(workspaceId, actor, request, receipt.fingerprint, JSON.stringify(receipt.result));
          this.db
            .prepare('INSERT INTO events VALUES(?,?,?)')
            .run(workspaceId, receipt.result.event.sequence, JSON.stringify(receipt.result.event));
        },
        events: (after, limit) =>
          this.db
            .prepare(
              'SELECT payload FROM events WHERE workspace_id=? AND sequence>? ORDER BY sequence LIMIT ?',
            )
            .all(workspaceId, after, limit)
            .map((r) => JSON.parse(r.payload as string) as DomainEvent),
      });
    });
  }
  issueToken(
    actorId: string,
    label: string,
    token = randomBytes(32).toString('base64url'),
  ): string {
    this.db
      .prepare('INSERT OR IGNORE INTO tokens VALUES(?,?,?,?)')
      .run(hash(token), actorId, label, new Date().toISOString());
    return token;
  }
  authenticate(token: string): string | undefined {
    if (token.length < 32 || token.length > 256) return undefined;
    return (
      this.db.prepare('SELECT actor_id FROM tokens WHERE hash=?').get(hash(token)) as
        | { actor_id: string }
        | undefined
    )?.actor_id;
  }
  revokeToken(token: string): void {
    this.db.prepare('DELETE FROM tokens WHERE hash=?').run(hash(token));
  }
  async backup(path: string): Promise<void> {
    await backup(this.db, path);
  }
  close(): void {
    this.db.close();
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
