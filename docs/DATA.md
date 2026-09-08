# Data you can keep

All authoritative work is stored in `.statework/statework.sqlite` (or under `STATEWORK_HOME`). The directory also holds `local-token`. Browser local storage holds presentation preferences and the last workspace ID, not your work items. The browser access token stays in memory. There are no remote storage, analytics, font or image requests.

## Portable snapshot

Use Export workspace in the browser, `work.export(id)`, or:

```sh
npm run cli -- export personal personal-snapshot.json
```

The JSON format is `{format:"statework.snapshot",formatVersion:1,exportedAt,state}`. It preserves work IDs, item versions, relationships, saved views and namespaced extensions. It excludes credentials, membership and past events/receipts. Treat snapshots as private work content. They are portable data, not encrypted backups.

Import always creates a **new** workspace with the chosen ID/title, revision 0 and a new event history. It validates dates, schemas, uniqueness, graph integrity and completion rules first. An existing workspace cannot be overwritten. Imported work is owned by the importing connection; imported JSON cannot grant roles. Unknown extension namespaces survive as inert data.

HTTP/browser imports are limited to approximately 1 MB. Use the CLI/SDK for larger valid snapshots. The CLI refuses to overwrite export files.

## Full database backup

```sh
npm run cli -- backup statework-backup.sqlite
```

This uses SQLite's online backup API, so the HTTP service can remain running. The destination must be new. It includes **all** workspaces, memberships, events, retry receipts and hashed tokens. Keep backups private. For a complete restore, preserve the matching `local-token` file separately as well. The CLI has direct filesystem-owner authority; a scoped connection cannot invoke the backup command.

To restore, stop every process using the destination database. Preserve the existing data directory under a different name. Create a fresh private directory, place the backup there as `statework.sqlite`, and copy its matching `local-token` into it. Point `STATEWORK_HOME` at the new directory and start StateWork. If no token file exists, startup generates a new local-owner token. A mismatched or revoked existing token file causes an explicit failure. Never replace only the live SQLite main file while an old WAL/SHM or writer is active.

Database migration 1 is installed transactionally. Future versions must back up before schema upgrades and add migration tests. A newer database schema is rejected by this version. Use snapshots for migration between different storage adapters; use a full database backup to preserve history and retry guarantees.

## Operational limits

The local filesystem and OS account are trusted. Data is not encrypted by StateWork; use operating-system disk encryption where appropriate. Private Unix file modes are requested for the directory/token; Windows uses the parent directory's inherited ACL. The server only binds `127.0.0.1`, never a public or LAN address. No work occurs while all StateWork processes are stopped. Calendar recurrence, scheduled notifications, sync and conflict-free offline replicas are not present.
