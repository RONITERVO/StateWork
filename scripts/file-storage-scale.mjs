// Explicit resource regression: node --max-old-space-size=256 scripts/file-storage-scale.mjs
// Synthetic bytes only. The test creates and removes its own temporary databases and package.
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { SqliteStore, exportFilePackage, importFilePackage } from '@statework/node';
import { WorkService } from '@statework/sdk';
const parent = resolve(tmpdir());
const root = mkdtempSync(join(parent, 'statework-scale-'));
let store;
const started = Date.now();
try {
  store = new SqliteStore(join(root, 'original.sqlite'));
  const c = new WorkService(store).connect('owner');
  c.create({ id: 'work', title: 'Synthetic large file regression' });
  c.execute('work', {
    schemaVersion: 1,
    requestId: 'task',
    expectedRevision: 0,
    commands: [{ type: 'item.create', item: { id: 'task', title: 'Fixture', kind: 'task' } }],
  });
  // 551 MiB unique total, including an 89 MiB file, mirrors the demonstrated workload.
  for (let i = 0; i < 7; i++) {
    const bytes = new Uint8Array((i === 0 ? 89 : 77) * 1024 ** 2).fill(i + 1);
    await c.attach(
      'work',
      {
        requestId: `file-${i}`,
        expectedRevision: i + 1,
        asset: {
          id: `file-${i}`,
          taskIds: ['task'],
          name: `synthetic-${i}.bin`,
          mediaType: 'application/octet-stream',
          description: 'Synthetic test bytes',
          locator: 'Synthetic fixture',
          replaces: null,
        },
      },
      bytes,
    );
  }
  const expected = c.assetManifest('work').map(({ id, sha256, size }) => ({ id, sha256, size }));
  assert.equal(c.storageInfo('work').storedBytes, 551 * 1024 ** 2);
  assert.throws(() => c.exportBundle('work'), /package-export/);
  const target = join(root, 'portable');
  const exported = exportFilePackage(c, 'work', target);
  assert.equal(exported.files, 7);
  assert.equal(exported.bytes, 551 * 1024 ** 2);
  store.close();
  store = new SqliteStore(join(root, 'restored.sqlite'));
  const copy = new WorkService(store).connect('new-owner');
  importFilePackage(copy, target, { id: 'copy', title: 'Restored synthetic work' });
  assert.deepEqual(
    copy.assetManifest('copy').map(({ id, sha256, size }) => ({ id, sha256, size })),
    expected,
  );
  for (const asset of expected) {
    const { bytes } = copy.asset('copy', asset.id); // SQLite verifies every persisted SHA-256.
    assert.equal(bytes.byteLength, asset.size);
  }
  assert.equal(copy.storageInfo('copy').storedBytes, 551 * 1024 ** 2);
  console.log(
    JSON.stringify({
      passed: true,
      files: 7,
      uniqueMiB: 551,
      largestMiB: 89,
      elapsedSeconds: (Date.now() - started) / 1000,
      maxRssMiB: process.resourceUsage().maxRSS / 1024,
    }),
  );
} finally {
  store?.close();
  if (!resolve(root).startsWith(parent + (process.platform === 'win32' ? '\\' : '/')))
    throw new Error('Refusing cleanup outside the temporary parent.');
  rmSync(root, { recursive: true, force: true });
}
