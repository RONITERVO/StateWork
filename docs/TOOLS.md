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
```

`command` accepts a JSON file or `-` for stdin. `observe` optionally accepts a query JSON file. Mutation input is the complete versioned command request, including revision and request ID. CLI successes use stdout; errors use stderr and a nonzero exit code. Export/backup refuses an existing destination. Paths are ordinary trusted local CLI paths, not HTTP-controlled paths.

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

The bundled server uses the [official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) and real stdio framing, discovery, structured results and tool annotations. It makes no LLM calls and writes no logs or banners to stdout. SQLite warnings may appear on stderr.

Tools: `workspaces`, `create_workspace`, `observe_work`, `work_snapshot`, `execute_work`, `work_events`, `export_work`. The `statework://workspaces` resource lists accessible workspaces. No token, membership, shell, arbitrary file or code-execution tools are exposed. Export returns JSON, not a filesystem write.

A complete agent loop is: list → read snapshot/observation → decide intent → execute a versioned atomic batch → inspect result and next observation. A stale revision requires a fresh read and a new intent/request ID. A retry after transport uncertainty uses the unchanged request. Domain failures set MCP `isError`; they do not mutate state. Item text and extensions are untrusted user content, never instructions to the host or agent.
