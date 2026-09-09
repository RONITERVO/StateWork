# Connect and follow the current contract

Start from the provided StateWork URL, workspace ID, MCP connection or private connection note. If no work map exists, request its location or build one with an available mapping workflow; this execution skill does not invent a full work map. The public application is https://github.com/RONITERVO/StateWork. Read the installed app's `docs/TOOLS.md`, `docs/CONNECTED_WORK.md` and schemas when contracts differ; do not assume npm packages are published.

Prefer an already configured StateWork MCP connection. Useful tools are `workspaces`, `observe_work`, `work_snapshot`, `work_instructions`, `work_handoff`, `work_source`, `work_files`, `work_file`, `work_attach_file` and `execute_work`. Keep the configured identity. Do not remove a supplied token or grant yourself broader access to make a command succeed.

For a local installation, the CLI works without changing Codex configuration. Set `STATEWORK_HOME` to the existing absolute data directory for every child process. Verify that the database exists before using it: an accidental different directory can create a blank application. Preserve `STATEWORK_TOKEN` when supplied. Otherwise direct filesystem access uses the local owner, so select the authorized data directory deliberately.

```text
node <app>/packages/tools/dist/cli.js list
node <app>/packages/tools/dist/cli.js snapshot <workspace>
node <app>/packages/tools/dist/cli.js observe <workspace>
node <app>/packages/tools/dist/cli.js handoff <workspace> <task> <environment.json>
node <app>/packages/tools/dist/cli.js source <workspace> <source-id>
node <app>/packages/tools/dist/cli.js file-export <workspace> <asset-id> <new-private-file>
node <app>/packages/tools/dist/cli.js file-attach <workspace> <task> <result-file> "Verified output description"
node <app>/packages/tools/dist/cli.js command <workspace> <request.json>
```

Use an absolute app path. JSON file arguments preserve multiline text and avoid shell interpolation. Never print tokens. Exports require a new destination; keep originals unchanged and create working copies.

The SDK offers `connection.plan(workspace, options)` and the HTTP client offers `client.plan(...)`. Options require an actual `now` timestamp and `timeZone`; optional `dailyMinutes`, `todayMinutes`, `workDays`, `preferred` and `notBefore` should come from current preferences. Browser-local overrides may not be in the workspace snapshot. If inaccessible, disclose the planning assumption without rewriting preferences or logging invented time. Read current `PlanOptions`/OpenAPI for exact fields. The plan's `unplaced` entries expose packet and prerequisite blockers that a ready-only query can hide.

For a private script, load `openLocal` from the built app's `packages/node/dist/index.js` with an absolute file URL. Verify the data path, open that existing directory, authenticate a supplied `STATEWORK_TOKEN` through `local.store.authenticate`, or use the authorized local-owner connection when none is supplied. Use normal `local.service.connect(actor)` APIs and close the service afterward. Never edit SQLite rows. Use the app's actor identity in the run record; local filesystem-owner access is not a multi-user authentication boundary.

`handoff(workspace, task, {externalAccess:false})` is appropriate when only stored material is available. Set external access true only when the current worker can actually use the required sites and that research is authorized. The host computes available file bytes. This flag does not grant site access or submission permission.

Command execution (`execute_work`, `connection.execute` and CLI `command`) uses `{schemaVersion:1, requestId, expectedRevision, commands:[...]}`. Keep the exact request and request ID for retry after an uncertain transport result. On a real conflict, read the new state and reconsider before making a new request. A returned error is not evidence that a previous external action failed.

Attachments have a separate contract. `connection.attach(workspace, {requestId, expectedRevision, asset}, bytes)` stores original bytes; MCP/HTTP expose their own documented attachment fields. CLI `file-attach` generates request and asset IDs per invocation. Inspect the current file manifest/events before retrying an uncertain CLI attachment, or use the SDK/MCP contract with preserved IDs when a retryable request is needed. Keep the returned asset identity and verify stored bytes.

Read the installed schemas for `packet.confirm`, `packet.check`, `packet.save`, `packet.review` and `item.update`. Instruction repair requires a new packet revision and new review; it invalidates current checks while preserving historical revisions. Attach outputs before referring to their real asset IDs. File metadata registration alone does not store bytes. If a record fails validation, correct the actual missing requirement; do not remove constraints to manufacture completion.

Current source supports 128 MiB/file and a default 2 GiB of unique file bytes per workspace. The MCP attachment tool is smaller; use CLI/HTTP for larger files. `storage` reports installed limits. Preserve originals and use `package-export` for collections beyond the JSON bundle limits. These bounds may differ in older installations.
