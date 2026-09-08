import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemoryStore,
  WorkService,
  parse,
  requestSchema,
  validateState,
  defaultProfile,
  textAdapter,
  spatialAdapter,
  negotiate,
  WorkError,
} from '@statework/sdk';
import type { CommandRequest } from '@statework/core';
import { SqliteStore } from '@statework/node';
const dirs: string[] = [];
const stores: SqliteStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0))
    try {
      store.close();
    } catch {}
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const request = (id = 'a'): CommandRequest => ({
  schemaVersion: 1,
  requestId: `create-${id}`,
  expectedRevision: 0,
  commands: [{ type: 'item.create', item: { id, kind: 'task', title: `Task ${id}` } }],
});
function setup(kind: 'memory' | 'sqlite') {
  const dir = kind === 'sqlite' ? mkdtempSync(join(tmpdir(), 'statework-test-')) : '';
  if (dir) dirs.push(dir);
  const path = join(dir, 'work.sqlite');
  const store = kind === 'memory' ? new MemoryStore() : new SqliteStore(path);
  if (store instanceof SqliteStore) stores.push(store);
  const service = new WorkService(store, () => '2026-09-08T10:00:00.000Z');
  const owner = service.connect('owner');
  owner.create({ id: 'w', title: 'Work' });
  return { store, service, owner, path };
}
describe.each(['memory', 'sqlite'] as const)('%s adapter contract', (kind) => {
  it('commits state, event and idempotency receipt together', () => {
    const { owner } = setup(kind);
    const req = request();
    const result = owner.execute('w', req);
    expect(owner.execute('w', req)).toEqual(result);
    expect(owner.snapshot('w').workspace.revision).toBe(1);
    expect(owner.events('w').events).toHaveLength(1);
    expect(() =>
      owner.execute('w', { ...req, commands: [{ type: 'workspace.rename', title: 'different' }] }),
    ).toThrow(/different content/);
  });
  it('rolls back failed batches and permits correction with the same unused request ID', () => {
    const { owner } = setup(kind);
    const req = request();
    expect(() =>
      owner.execute('w', {
        ...req,
        commands: [
          ...req.commands,
          {
            type: 'relation.add',
            relation: { id: 'x', kind: 'contains', from: 'a', to: 'absent' },
          },
        ],
      }),
    ).toThrow();
    expect(owner.snapshot('w').items).toEqual([]);
    expect(owner.events('w').events).toEqual([]);
    expect(owner.execute('w', req).revision).toBe(1);
  });
  it('isolates workspace membership and prevents permission fields in commands', () => {
    const { owner, service, store } = setup(kind);
    store.grant('w', 'reader', 'reader');
    store.grant('w', 'editor', 'editor');
    const reader = service.connect('reader'),
      editor = service.connect('editor'),
      stranger = service.connect('stranger');
    expect(stranger.list()).toEqual([]);
    expect(() => stranger.snapshot('w')).toThrow(/unavailable/);
    expect(() => reader.execute('w', request())).toThrow(/read-only/);
    expect(() => owner.execute('w', { ...request(), role: 'owner', actorId: 'stranger' })).toThrow(
      /Invalid request/,
    );
    editor.execute('w', request());
    store.grant('w', 'editor', 'reader');
    expect(() => editor.execute('w', request())).toThrow(/read-only/);
  });
  it('imports into a new workspace, validates graphs, and excludes credentials and history', () => {
    const { owner } = setup(kind);
    owner.execute('w', request());
    const exported = owner.export('w');
    expect(Object.keys(exported).sort()).toEqual([
      'exportedAt',
      'format',
      'formatVersion',
      'state',
    ]);
    const imported = owner.import(exported, { id: 'copy', title: 'Copy' });
    expect(imported.items).toEqual(exported.state.items);
    expect(imported.workspace.revision).toBe(0);
    expect(owner.events('copy').events).toEqual([]);
    expect(() => owner.import(exported, { id: 'w', title: 'Overwrite' })).toThrow(/already exists/);
    const invalid = structuredClone(exported);
    invalid.state.items.push(invalid.state.items[0]!);
    expect(() => owner.import(invalid, { id: 'bad', title: 'Bad' })).toThrow(/Duplicate/);
  });
  it('paginates durable events without dropping cursors', () => {
    const { owner } = setup(kind);
    owner.execute('w', request());
    owner.execute('w', { ...request('b'), expectedRevision: 1 });
    const first = owner.events('w', 0, 1);
    expect(first.nextCursor).toBe(1);
    expect(first.revision).toBe(2);
    expect(owner.events('w', first.nextCursor).events[0]!.sequence).toBe(2);
    expect(() => owner.events('w', 5)).toThrow(/ahead/);
  });
});
describe('SQLite durability', () => {
  it('survives reopening, serialized competing writers, token revocation and full database backup', async () => {
    const { owner, path, store } = setup('sqlite');
    const sqlite = store as SqliteStore;
    const token = sqlite.issueToken('owner', 'Test');
    owner.execute('w', request());
    sqlite.close();
    const reopened = new SqliteStore(path);
    stores.push(reopened);
    const connection = new WorkService(reopened).connect('owner');
    expect(reopened.authenticate(token)).toBe('owner');
    expect(connection.execute('w', request()).revision).toBe(1);
    const second = new SqliteStore(path);
    stores.push(second);
    const other = new WorkService(second).connect('owner');
    connection.execute('w', { ...request('b'), expectedRevision: 1 });
    expect(() => other.execute('w', { ...request('c'), expectedRevision: 1 })).toThrow(/changed/);
    const backupPath = join(dirs.at(-1)!, 'backup.sqlite');
    await reopened.backup(backupPath);
    const restored = new SqliteStore(backupPath);
    stores.push(restored);
    expect(new WorkService(restored).connect('owner').snapshot('w').items).toHaveLength(2);
    expect(restored.authenticate(token)).toBe('owner');
    reopened.revokeToken(token);
    expect(reopened.authenticate(token)).toBeUndefined();
  });
  it('rolls back adapter writes when the transaction callback throws after commit staging', () => {
    const { store, owner } = setup('sqlite');
    expect(() =>
      store.transact('w', 'owner', (tx) => {
        const state = structuredClone(tx.state);
        state.workspace.revision = 1;
        tx.commit(state, 'owner', 'broken', {
          fingerprint: 'broken',
          result: {
            revision: 1,
            event: {
              sequence: 1,
              workspaceId: 'w',
              actorId: 'owner',
              at: '2026-09-08T00:00:00.000Z',
              requestId: 'broken',
              commands: [],
            },
          },
        });
        throw new Error('simulated interruption');
      }),
    ).toThrow(/interruption/);
    expect(owner.snapshot('w').workspace.revision).toBe(0);
    expect(owner.events('w').events).toEqual([]);
  });
});
describe('validation and perception', () => {
  it('treats explicit undefined optional fields like JSON omission without erasing defaults', () => {
    const { owner } = setup('memory');
    const req = request();
    (req.commands[0] as { item: Record<string, unknown> }).item.status = undefined;
    (req.commands[0] as { item: Record<string, unknown> }).item.tags = undefined;
    owner.execute('w', req);
    expect(owner.snapshot('w').items[0]).toMatchObject({ status: 'inbox', tags: [] });
    expect(() =>
      owner.execute('w', {
        schemaVersion: 1,
        requestId: 'empty',
        expectedRevision: 1,
        commands: [
          { type: 'item.update', id: 'a', expectedVersion: 1, patch: { title: undefined } },
        ],
      }),
    ).toThrow(/Invalid request/);
  });
  it.each(['2026-02-30', '2026-13-01', '2026-1-01'])(
    'rejects malformed calendar date %s',
    (dueDate) => {
      const r = request();
      (r.commands[0] as { item: Record<string, unknown> }).item.dueDate = dueDate;
      expect(() => parse(requestSchema, r)).toThrow(WorkError);
    },
  );
  it('accepts leap day and rejects invalid zones and reversed instants', () => {
    const r = request();
    const item = (r.commands[0] as { item: Record<string, unknown> }).item;
    item.dueDate = '2028-02-29';
    expect(() => parse(requestSchema, r)).not.toThrow();
    item.schedule = {
      start: '2026-09-08T10:00:00.000Z',
      end: '2026-09-08T09:00:00.000Z',
      timeZone: 'Europe/Helsinki',
    };
    expect(() => parse(requestSchema, r)).toThrow();
    item.schedule = {
      start: '2026-09-08T08:00:00.000Z',
      end: '2026-09-08T09:00:00.000Z',
      timeZone: 'Mars/Olympus',
    };
    expect(() => parse(requestSchema, r)).toThrow();
  });
  it('rejects unknown fields, executable extension keys, cyclic data, and excessive depth', () => {
    const r = request();
    const item = (r.commands[0] as { item: Record<string, unknown> }).item;
    item.extensions = { eval: 'source' };
    expect(() => parse(requestSchema, r)).toThrow();
    item.extensions = { 'example.test/context': { safe: true } };
    expect(() => parse(requestSchema, r)).not.toThrow();
    item.extensions = {};
    item.extensions = item;
    expect(() => parse(requestSchema, r)).toThrow(/Cyclic/);
    let data: unknown = 'x';
    for (let i = 0; i < 30; i++) data = { child: data };
    expect(() => parse(requestSchema, data)).toThrow(/nesting/);
  });
  it('preserves unknown namespaced data through export and view projections', () => {
    const { owner } = setup('memory');
    const r = request();
    (r.commands[0] as { item: Record<string, unknown> }).item.extensions = {
      'company.test/capacity': { spoons: 2, preferredWindow: 'morning' },
    };
    owner.execute('w', r);
    expect(validateState(owner.export('w').state).items[0]!.extensions).toEqual({
      'company.test/capacity': { spoons: 2, preferredWindow: 'morning' },
    });
    const observation = owner.observe('w');
    expect(textAdapter.render(observation, defaultProfile)).toContain('Task a');
    expect(spatialAdapter.render(observation, defaultProfile).nodes[0]!.id).toBe('a');
  });
  it('negotiates capabilities explicitly and can fall back to text without changing semantics', () => {
    expect(
      negotiate(textAdapter, { ...defaultProfile, output: ['braille'], input: ['switch'] })
        .supported,
    ).toBe(true);
    expect(
      negotiate(
        { ...spatialAdapter, requires: ['xr'] },
        { ...defaultProfile, output: ['spatial'], input: ['gaze'] },
      ).reasons,
    ).toContain('Missing capability: xr.');
    expect(
      negotiate(spatialAdapter, { ...defaultProfile, output: ['text'], input: ['switch'] })
        .supported,
    ).toBe(false);
  });
});
