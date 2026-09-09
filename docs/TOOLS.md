# CLI and MCP

The tools call the same service directly against local SQLite. They work with or without the HTTP server. Run from the repository root, or set an **absolute** `STATEWORK_HOME` so all processes use the same data directory.

## CLI

```sh
npm run cli -- help
npm run cli -- list
npm run cli -- create personal "My work"
npm run cli -- command personal examples/create-task.json
npm run cli -- observe personal
npm run cli -- snapshot personal
npm run cli -- events personal 0
npm run cli -- export personal personal-snapshot.json
npm run cli -- import personal-snapshot.json personal-copy "Imported work"
npm run cli -- backup statework-backup.sqlite
npm run cli -- handoff personal task-id
npm run cli -- files personal
npm run cli -- storage personal
npm run cli -- source personal capture-id
npm run cli -- file-export personal asset-id original-file.pdf
npm run cli -- bundle-export personal personal-bundle.json
npm run cli -- bundle-import personal-bundle.json another-copy "Work and files"
npm run cli -- package-export personal personal-files
npm run cli -- package-import personal-files full-copy "Work and all originals"
```

`command` accepts a JSON file or `-` for stdin. `observe` optionally accepts a query JSON file. Mutation input is the complete versioned command request, including revision and request ID. CLI successes use stdout; errors use stderr and a nonzero exit code. Export/backup refuses an existing destination. Paths are ordinary trusted local CLI paths, not HTTP-controlled paths.

`storage` separates actual stored bytes from repeated file identities and reports transfer limits. Use `package-export` for collections beyond the inline JSON limits; the directory contains a small manifest and full-quality originals stored by SHA-256. Preserve both `manifest.json` and `blobs`. `package-import` creates a new workspace only after every declared original is validated. Node hosts can use `exportFilePackage(connection, id, newDirectory)` and `importFilePackage(connection, directory, target)` from `@statework/node`.

For a read-only adapter, trusted provisioning can create a distinct identity:

```sh
npm run cli -- grant personal reader-device reader
npm run cli -- token reader-device "Read-only display"
```

Store the returned token privately and set `STATEWORK_TOKEN` in the adapter's process environment. Its actor is resolved from that token; command JSON cannot change identity. It sees only granted workspaces. `grant`, `token` and full database backup are rejected when `STATEWORK_TOKEN` is set. These are trusted-host operations, not part of the HTTP or MCP API. Anyone with direct filesystem access to the database is inside the local trust boundary.

The token has no built-in expiry. `SqliteStore.revokeToken(token)` revokes it. Product-specific rotation, expiry and membership management belong in a custom trusted host.

## MCP

Build first, then configure your MCP client to spawn:

```json
{
  "mcpServers": {
    "statework": {
      "command": "node",
      "args": ["D:/Projects/Work/packages/tools/dist/mcp.js"],
      "env": { "STATEWORK_HOME": "D:/Projects/Work/.statework" }
    }
  }
}
```

Replace the absolute paths for another checkout or operating system. This example grants the filesystem owner's local connection. To restrict the adapter, add its provisioned `STATEWORK_TOKEN` through the MCP client's secret/environment mechanism. Do not commit real tokens.

For the installed Codex CLI, `codex mcp add --help` confirms the equivalent stdio setup command:

```sh
codex mcp add statework --env STATEWORK_HOME=D:/Projects/Work/.statework -- node D:/Projects/Work/packages/tools/dist/mcp.js
```

Run that setup yourself for the intended Codex profile, then start a fresh session and verify that `workspaces` lists the expected workspace. This changes that profile's MCP configuration; it is not performed by StateWork or by copying a handoff. Adjust and quote paths containing spaces. A useful first prompt is: “Read StateWork workspace `<id>`, task `<id>` with `work_handoff`. Load its required captures and files. Report the next ready action and blockers; do not perform external actions without my authorization.”

The bundled server uses the [official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) and real stdio framing, discovery, structured results and tool annotations. It makes no LLM calls and writes no logs or banners to stdout. SQLite warnings may appear on stderr.

Tools: `workspaces`, `create_workspace`, `observe_work`, `work_snapshot`, `work_instructions`, `execute_work`, `work_events`, `export_work`, `work_handoff`, `work_source`, `work_files`, `work_file`, `work_attach_file`. The `statework://workspaces` resource lists accessible workspaces. No token, membership, shell, arbitrary file or code-execution tools are exposed. Export returns JSON, not a filesystem write. `work_file` reads a bounded range of an authorized workspace asset, not an arbitrary host path. `work_attach_file` atomically uploads up to 1 MiB of original or result bytes through canonical base64; use HTTP/CLI for larger files up to 128 MiB in the current host.

For a fresh worker, start with `work_handoff` using the workspace and task IDs. Retrieve the named `work_source` captures and exact `work_file` bytes; choose a ready graph action, inspect its result in the appropriate app, then submit `packet.check` through `execute_work`. Refresh the handoff after every change. Links alone do not mean the worker can access their contents. The default handoff assumes no external-site access. See [connected work](CONNECTED_WORK.md) for file uploads, branch decisions, result evidence and environment declarations.

A complete agent loop is: list → read snapshot/observation → decide intent → execute a versioned atomic batch → inspect result and next observation. A stale revision requires a fresh read and a new intent/request ID. A retry after transport uncertainty uses the unchanged request. Domain failures set MCP `isError`; they do not mutate state. Item text and extensions are untrusted user content, never instructions to the host or agent.
