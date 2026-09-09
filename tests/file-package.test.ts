import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportFilePackage, importFilePackage, SqliteStore } from '@statework/node';
import { createServer, openapi } from '@statework/server';
import {
  FILE_LIMIT,
  INLINE_FILE_LIMIT,
  MemoryStore,
  WorkService,
  WorkClient,
  assetInputSchema,
  filePackageSchema,
  fileStorageLimits,
  parse,
} from '@statework/sdk';
import type { AssetBytes, FilePackageManifest, WorkspaceStore } from '@statework/sdk';

const directories: string[] = [];
const closers: (() => void)[] = [];
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'statework-package-test-'));
  directories.push(path);
  return path;
}
function fixture(store: WorkspaceStore = new MemoryStore()) {
  const service = new WorkService(store);
  closers.push(() => service.close());
  const c = service.connect('owner');
  c.create({ id: 'work', title: 'Original work' });
  c.execute('work', {
    schemaVersion: 1,
    requestId: 'task',
    expectedRevision: 0,
    commands: [{ type: 'item.create', item: { id: 'task', title: 'A task', kind: 'task' } }],
  });
  const attach = (id: string, bytes: Uint8Array) =>
    c.attach(
      'work',
      {
        requestId: id,
        expectedRevision: c.snapshot('work').workspace.revision,
        asset: {
          id,
          taskIds: ['task'],
          name: `${id}.bin`,
          mediaType: 'application/octet-stream',
          description: 'Original task input',
          locator: 'https://example.test/assignment',
          replaces: null,
        },
      },
      bytes,
    );
  return { c, service, attach };
}
afterEach(() => {
  for (const close of closers.splice(0).reverse()) close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe.each(['memory', 'sqlite'])('portable originals: %s', (kind) => {
  const makeStore = (quota = 1024) =>
    kind === 'memory'
      ? new MemoryStore({ workspaceFileLimit: quota })
      : new SqliteStore(join(directory(), 'work.sqlite'), { workspaceFileLimit: quota });

  it('deduplicates bytes while retaining aliases, exact provenance, and explicit missing identities', async () => {
    const { c, attach } = fixture(makeStore());
    const original = new Uint8Array([0, 255, 8, 99]);
    await attach('drawing', original);
    await attach('shared-drawing', original);
    expect(c.storageInfo('work')).toMatchObject({
      storedBytes: 4,
      logicalBytes: 8,
      assetCount: 2,
      uniqueFiles: 1,
      duplicateFiles: 1,
      storedFiles: 1,
      missingFiles: 0,
      largestFileBytes: 4,
    });
    const destination = join(directory(), 'portable');
    expect(exportFilePackage(c, 'work', destination)).toMatchObject({
      files: 1,
      bytes: 4,
      missing: [],
    });
    expect(readdirSync(destination).sort()).toEqual(['blobs', 'manifest.json']);
    const manifest = parse(
      filePackageSchema,
      JSON.parse(readFileSync(join(destination, 'manifest.json'), 'utf8')),
    );
    expect(readdirSync(join(destination, 'blobs'))).toEqual([digest(original)]);
    expect(manifest.snapshot.state.instructions?.assets).toEqual(
      c.snapshot('work').instructions?.assets,
    );
    expect(JSON.stringify(manifest)).not.toContain('Bearer');
    const restored = importFilePackage(c, destination, { id: 'copy', title: 'Restored' });
    expect(restored.workspace.revision).toBe(0);
    expect(c.asset('copy', 'drawing').bytes).toEqual(original);
    expect(c.asset('copy', 'shared-drawing').bytes).toEqual(original);
    c.import(c.export('work'), { id: 'metadata', title: 'Metadata only' });
    const missingDirectory = join(directory(), 'missing');
    expect(exportFilePackage(c, 'metadata', missingDirectory)).toMatchObject({
      files: 0,
      bytes: 0,
      missing: [digest(original)],
    });
    importFilePackage(c, missingDirectory, { id: 'missing-copy', title: 'Missing originals' });
    expect(c.storageInfo('missing-copy').missingFiles).toBe(1);
    expect(() => c.asset('missing-copy', 'drawing')).toThrow('restoring');
    expect(() => importFilePackage(c, destination, { id: 'copy', title: 'Overwrite' })).toThrow(
      'exists',
    );
  });

  it('rolls back bytes and metadata if a later file is corrupted or a source fails', async () => {
    const store = makeStore();
    const { c, attach } = fixture(store);
    await attach('first', new Uint8Array([1, 2, 3]));
    await attach('second', new Uint8Array([4, 5, 6]));
    const path = join(directory(), 'portable');
    exportFilePackage(c, 'work', path);
    const manifest = JSON.parse(
      readFileSync(join(path, 'manifest.json'), 'utf8'),
    ) as FilePackageManifest;
    writeFileSync(join(path, 'blobs', manifest.files[1]!), new Uint8Array([9, 9, 9]));
    expect(() => importFilePackage(c, path, { id: 'broken', title: 'Broken' })).toThrow('identity');
    expect(c.list().map((w) => w.id)).toEqual(['work']);
    const observed: string[] = [];
    expect(() =>
      c.importFilePackage(
        manifest,
        { id: 'failure', title: 'Failure' },
        {
          read(hash) {
            observed.push(hash);
            if (observed.length === 2) throw new Error('Synthetic read failure');
            return new Uint8Array([1, 2, 3]);
          },
          digest,
        },
      ),
    ).toThrow('Synthetic read failure');
    expect(observed).toHaveLength(2);
    expect(c.list()).toHaveLength(1);
    if (kind === 'sqlite') {
      // Reuse the failed ID: no workspace, memberships, or blobs survived the transaction.
      expect(c.create({ id: 'failure', title: 'Clean retry' }).workspace.revision).toBe(0);
      expect(c.storageInfo('failure').storedFiles).toBe(0);
    }
  });

  it('enforces unique-byte quota atomically without charging aliases twice', async () => {
    const { c, attach } = fixture(makeStore(5));
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await attach('first', bytes);
    await attach('alias', bytes);
    const before = c.snapshot('work');
    await expect(attach('overflow', new Uint8Array([8, 9]))).rejects.toThrow('quota');
    expect(c.snapshot('work')).toEqual(before);
    expect(c.storageInfo('work').storedBytes).toBe(4);
    const path = join(directory(), 'portable');
    exportFilePackage(c, 'work', path);
    const small = fixture(makeStore(3));
    const read = vi.fn(() => bytes);
    const manifest = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8'));
    expect(() =>
      small.c.importFilePackage(manifest, { id: 'copy', title: 'Too big' }, { read, digest }),
    ).toThrow('quota');
    expect(read).not.toHaveBeenCalled();
    expect(small.c.list()).toHaveLength(1);
  });

  it('makes iterable creation atomic and keeps returned bytes isolated from stored originals', async () => {
    const store = makeStore();
    const { c, attach } = fixture(store);
    const bytes = new Uint8Array([12, 34]);
    await attach('file', bytes);
    bytes.fill(9);
    const returned = c.asset('work', 'file').bytes;
    returned.fill(8);
    expect(c.asset('work', 'file').bytes).toEqual(new Uint8Array([12, 34]));
    function* failing(): IterableIterator<AssetBytes> {
      const first = new Uint8Array([1]);
      yield { sha256: digest(first), bytes: first };
      throw new Error('Iterator failure');
    }
    const next = c.snapshot('work');
    next.workspace.id = 'iterator';
    expect(() => store.create(next, 'owner', failing())).toThrow('Iterator failure');
    expect(c.list().map((w) => w.id)).not.toContain('iterator');
  });
});

it('rejects ambiguous manifests and applies import policy before reading originals', async () => {
  const { c, attach } = fixture();
  await attach('file', new Uint8Array([1]));
  let manifest!: FilePackageManifest;
  c.exportFilePackage('work', (value) => {
    manifest = value;
  });
  const read = vi.fn(() => new Uint8Array([1]));
  for (const changed of [
    { ...manifest, files: [] },
    { ...manifest, missing: [...manifest.files] },
    { ...manifest, files: ['../outside'] },
  ]) {
    expect(() =>
      c.importFilePackage(changed, { id: 'bad', title: 'Bad' }, { read, digest }),
    ).toThrow();
  }
  expect(read).not.toHaveBeenCalled();
  const service = new WorkService(new MemoryStore(), undefined, {
    beforeImport() {
      throw new Error('Host policy rejected import');
    },
  });
  closers.push(() => service.close());
  expect(() =>
    service
      .connect('owner')
      .importFilePackage(manifest, { id: 'bad', title: 'Bad' }, { read, digest }),
  ).toThrow('Host policy');
  expect(read).not.toHaveBeenCalled();
});

it('preflights legacy JSON limits without reading a blob and accepts larger file metadata', () => {
  const store = new MemoryStore();
  const { c } = fixture(store);
  const asset = {
    id: 'large',
    taskIds: ['task'],
    name: 'book.pdf',
    mediaType: 'application/pdf',
    size: INLINE_FILE_LIMIT + 1,
    sha256: 'a'.repeat(64),
    description: '',
    locator: 'Assignment',
    replaces: null,
  };
  expect(assetInputSchema.parse({ ...asset, size: FILE_LIMIT }).size).toBe(FILE_LIMIT);
  expect(() => assetInputSchema.parse({ ...asset, size: FILE_LIMIT + 1 })).toThrow();
  c.execute('work', {
    schemaVersion: 1,
    requestId: 'large',
    expectedRevision: 1,
    commands: [{ type: 'asset.register', asset }],
  });
  const original = store.transact.bind(store);
  const read = vi.fn(() => {
    throw new Error('Should not read any blob');
  });
  vi.spyOn(store, 'transact').mockImplementation((id, actor, fn) =>
    original(id, actor, (tx) => fn({ ...tx, assetSize: () => asset.size, asset: read })),
  );
  expect(() => c.exportBundle('work')).toThrow('package-export');
  expect(read).not.toHaveBeenCalled();
});

it('uses a new export destination, cleans failed exports, and rejects asynchronous consumers', () => {
  const { c } = fixture();
  const parent = directory();
  const destination = join(parent, 'package');
  exportFilePackage(c, 'work', destination);
  const original = readFileSync(join(destination, 'manifest.json'));
  expect(() => exportFilePackage(c, 'work', destination)).toThrow();
  expect(readFileSync(join(destination, 'manifest.json'))).toEqual(original);
  const failed = join(parent, 'failed');
  expect(() => exportFilePackage(c, 'unavailable', failed)).toThrow('unavailable');
  expect(existsSync(failed)).toBe(false);
  expect(() => c.exportFilePackage('work', async () => undefined)).toThrow('synchronously');
});

it('rejects symlinked package directories and blob entries', async () => {
  const { c, attach } = fixture();
  await attach('file', new Uint8Array([1]));
  const parent = directory(),
    path = join(parent, 'package');
  exportFilePackage(c, 'work', path);
  const alias = join(parent, 'alias');
  symlinkSync(path, alias, process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => importFilePackage(c, alias, { id: 'alias', title: 'Link' })).toThrow('links');
  const blobs = join(path, 'blobs');
  const replacement = join(parent, 'other');
  exportFilePackage(c, 'work', replacement);
  rmSync(blobs, { recursive: true });
  symlinkSync(join(replacement, 'blobs'), blobs, process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => importFilePackage(c, path, { id: 'escaped', title: 'Escape' })).toThrow('links');
  expect(c.list()).toHaveLength(1);
});

it('validates host quotas and retains the default 128 MiB / 2 GiB limits', () => {
  expect(fileStorageLimits()).toEqual({
    fileBytes: 128 * 1024 ** 2,
    workspaceBytes: 2 * 1024 ** 3,
  });
  for (const quota of [0, -1, 1.5, NaN, Infinity, 65 * 1024 ** 3])
    expect(() => fileStorageLimits({ workspaceFileLimit: quota })).toThrow('quota');
});

it('serves storage limits through the authenticated HTTP/client boundary and documents upload bounds', async () => {
  const store = new MemoryStore({ workspaceFileLimit: 1024 });
  const { c, service, attach } = fixture(store);
  await attach('input', new Uint8Array([1, 2, 3]));
  store.grant('work', 'reader', 'reader');
  const app = await createServer({
    service,
    authenticate: (token) => (['owner', 'reader', 'stranger'].includes(token) ? token : undefined),
  });
  try {
    const headers = (actor: string) => ({
      host: 'localhost:4180',
      authorization: `Bearer ${actor}`,
    });
    const result = await app.inject({
      url: '/v1/workspaces/work/storage',
      headers: headers('reader'),
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual(c.storageInfo('work'));
    expect(
      (await app.inject({ url: '/v1/workspaces/work/storage', headers: headers('stranger') }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: '/v1/workspaces/work/storage',
          headers: { host: 'localhost:4180' },
        })
      ).statusCode,
    ).toBe(401);
    const fetcher = vi.fn(async () => new Response(result.body, { status: 200 }));
    const client = new WorkClient('http://localhost:4180', 'reader', fetcher as typeof fetch);
    expect(await client.storageInfo('work')).toEqual(c.storageInfo('work'));
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:4180/v1/workspaces/work/storage',
      expect.objectContaining({ headers: { Authorization: 'Bearer reader' } }),
    );
    const spec = openapi();
    expect(spec.paths['/workspaces/{id}/storage'].get.operationId).toBe('fileStorageInfo');
    expect(spec.paths['/workspaces/{id}/assets'].post.description).toContain('128 MiB');
  } finally {
    await app.close();
  }
});
