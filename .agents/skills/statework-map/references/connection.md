# Connect without depending on a previous chat

StateWork's public repository is https://github.com/RONITERVO/StateWork. These instructions target its 0.2 contracts. Read the installed version's `docs/TOOLS.md`, `docs/CONNECTED_WORK.md` and schemas when capabilities differ; never silently invent an API. Packages are not assumed to be published to npm.

## Fresh installation

If no app is installed, clone the public repository into a new user-appropriate directory, inspect its README and package engines, then run `npm ci` and `npm run build`. The 0.2 release supports Node 24.13+ within 24.x, or Node 25. Record the resolved git commit and Node version in the private research ledger. Do not reuse a private user's checkout, database or captures as a template.

Set `STATEWORK_HOME` to an absolute private data directory. Set `STATEWORK_DEMO=0` before first server start. Run `npm start` from the checkout; the default URL is `http://127.0.0.1:4180`. If another app uses that port, choose a free port through `STATEWORK_PORT`, without stopping the other app. Launch Windows background helpers hidden. Keep the chosen URL and data directory in a private connection note so another session can resume.

## Available connection

Prefer an already configured StateWork MCP connection. Verify `workspaces`, create a new workspace with `create_workspace`, and inspect `work_snapshot`. Use `execute_work` with the installed tool schema; `work_handoff`, `work_source`, `work_files` and `work_file` expose the worker's stored inputs.

Otherwise the checkout's CLI works without changing Codex configuration:

```text
node <app>/packages/tools/dist/cli.js create <workspace-id> "My work"
node <app>/packages/tools/dist/cli.js snapshot <workspace-id>
node <app>/packages/tools/dist/cli.js command <workspace-id> <request.json>
node <app>/packages/tools/dist/cli.js bundle-export <workspace-id> <new-bundle.json>
```

Pass `STATEWORK_HOME` explicitly to each child process or consistently in its environment. Preserve a supplied `STATEWORK_TOKEN`; never remove it to gain owner access. With no token, direct local filesystem access uses the local owner, so never point a test at the person's live data. Do not print tokens or browser session material into logs.

MCP setup is optional, not a requirement for finishing a map. If the user requests a persistent connector, inspect `codex mcp add --help` and the current official Codex documentation, then configure the intended profile with the absolute MCP script and data paths. A copied prompt does not install a connector or confer authorization.

## Deterministic local authoring

For large researched maps, a private `.mjs` authoring script can import `openLocal` from `<app>/packages/node/dist/index.js` and `blankPacket`, `packetContext` from `<app>/packages/sdk/dist/index.js` using absolute file URLs. Use the normal service connection, command validation, file attachment and export operations. Do not write SQLite tables or bypass commands.

For a copied standalone skill, `scripts/audit-map.mjs` takes the built app location explicitly; it has no undeclared dependency on the author's machine. It reads a bundle into a memory-only service and does not open the live data directory.
