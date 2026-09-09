# Data you can keep

All authoritative work is stored in `.statework/statework.sqlite` (or under `STATEWORK_HOME`). The directory also holds `local-token`. Browser local storage holds presentation preferences and the last workspace ID, not your work items. The browser access token stays in memory. There are no remote storage, analytics, font or image requests.

## Portable snapshot

Use Export workspace in the browser, `work.export(id)`, or:

```sh
npm run cli -- export personal personal-snapshot.json
```

The JSON format is `{format:"statework.snapshot",formatVersion:1,exportedAt,state}`. It preserves work IDs, item versions, relationships, saved views and namespaced extensions. It excludes credentials, membership and past events/receipts. Treat snapshots as private work content. They are portable data, not encrypted backups.

Import always creates a **new** workspace with the chosen ID/title, revision 0 and a new event history. It validates dates, schemas, uniqueness, graph integrity and completion rules first. An existing workspace cannot be overwritten. Imported work is owned by the importing connection; imported JSON cannot grant roles. Unknown extension namespaces survive as inert data.

The dedicated snapshot import route accepts 20 MiB; the browser limits snapshot files to 16 MiB. Ordinary command requests remain limited to approximately 1 MB. The CLI refuses to overwrite export files.

## Portable workspace with files

Use **Files → Workspace + files**, or `npm run cli -- bundle-export personal personal-bundle.json`. Import with **Import workspace + files** or `npm run cli -- bundle-import personal-bundle.json personal-copy "Imported work"`.

The versioned `statework.bundle` includes the snapshot, deduplicated original file bytes and an explicit missing-file list. Import checks every digest and file identity before atomically creating a new workspace. A snapshot or packet export preserves file metadata but does not include bytes. Restore a missing file only with bytes matching its saved digest; replacement files receive new identities.

Limits are 64 MiB per file and 256 MiB of unique bytes per workspace. Base64 increases JSON transfer size; the bundle import route accepts up to 380 MiB. Use a full database backup to retain events, receipts and memberships as well.

## Full database backup

```sh
npm run cli -- backup statework-backup.sqlite
```

This uses SQLite's online backup API, so the HTTP service can remain running. The destination must be new. It includes **all** workspaces, original files, memberships, events, retry receipts and hashed tokens. Keep backups private. For a complete restore, preserve the matching `local-token` file separately as well. The CLI has direct filesystem-owner authority; a scoped connection cannot invoke the backup command.

To restore, stop every process using the destination database. Preserve the existing data directory under a different name. Create a fresh private directory, place the backup there as `statework.sqlite`, and copy its matching `local-token` into it. Point `STATEWORK_HOME` at the new directory and start StateWork. If no token file exists, startup generates a new local-owner token. A mismatched or revoked existing token file causes an explicit failure. Never replace only the live SQLite main file while an old WAL/SHM or writer is active.

Database migration 2 adds original-file storage transactionally. Opening a version-1 database first creates a consistent adjacent `*.before-v2-<id>.sqlite` backup, including committed WAL data. If backup fails, upgrade stops. Preserve the matching local token for rollback with the old binary. A newer database schema is rejected. Use complete bundles between file-capable storage adapters; use a full database backup to preserve history and retry guarantees.

## Operational limits

The local filesystem and OS account are trusted. Data is not encrypted by StateWork; use operating-system disk encryption where appropriate. Private Unix file modes are requested for the directory/token; Windows uses the parent directory's inherited ACL. The server only binds `127.0.0.1`, never a public or LAN address. No work occurs while all StateWork processes are stopped. Calendar recurrence, scheduled notifications, sync and conflict-free offline replicas are not present.
