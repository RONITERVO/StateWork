import { it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '@statework/node';
import { WorkService } from '@statework/sdk';

it('preserves a consistent pre-upgrade database and all records when migrating storage version 1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'statework-migration-'));
  const path = join(dir, 'work.sqlite');
  try {
    const original = new SqliteStore(path),
      service = new WorkService(original),
      c = service.connect('owner');
    c.create({ id: 'work', title: 'Existing personal work' });
    c.execute('work', {
      schemaVersion: 1,
      requestId: 'seed',
      expectedRevision: 0,
      commands: [
        {
          type: 'item.create',
          item: { id: 'done', kind: 'task', title: 'Completed history', status: 'done' },
        },
      ],
    });
    const snapshot = c.export('work');
    const token = original.issueToken('owner', 'Existing login');
    service.close();
    const legacy = new DatabaseSync(path);
    legacy.exec('DROP TABLE assets; PRAGMA user_version=1;');
    legacy.close();
    const migrated = new SqliteStore(path);
    const next = new WorkService(migrated).connect('owner');
    expect(next.snapshot('work')).toEqual(snapshot.state);
    expect(next.events('work').events).toHaveLength(1);
    expect(migrated.authenticate(token)).toBe('owner');
    expect(migrated.upgradeBackup).not.toBeNull();
    const backup = new DatabaseSync(migrated.upgradeBackup!, { readOnly: true });
    expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
    expect(
      JSON.parse(
        String(backup.prepare('SELECT snapshot FROM workspaces WHERE id=?').get('work')?.snapshot),
      ),
    ).toEqual(snapshot.state);
    backup.close();
    const bytes = new Uint8Array([0, 255, 128, 10]);
    await next.attach(
      'work',
      {
        requestId: 'asset',
        expectedRevision: 1,
        asset: {
          id: 'original',
          taskIds: ['done'],
          name: 'original.bin',
          mediaType: 'application/octet-stream',
          description: 'Original file',
          locator: 'Migration test',
          replaces: null,
        },
      },
      bytes,
    );
    const completeBackup = join(dir, 'with-files.sqlite');
    await migrated.backup(completeBackup);
    const restored = new SqliteStore(completeBackup);
    expect(new WorkService(restored).connect('owner').asset('work', 'original').bytes).toEqual(
      bytes,
    );
    expect(restored.authenticate(token)).toBe('owner');
    restored.close();
    migrated.close();
    const newer = new DatabaseSync(path);
    newer.exec('PRAGMA user_version=99;');
    newer.close();
    expect(() => new SqliteStore(path)).toThrow('newer StateWork');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
