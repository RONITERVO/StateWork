# Choose a starting point

You do not have to adopt the reference UI to use StateWork. Start from an observation, keep the item IDs, and choose how a person or device moves between them. Submit work changes through the command service. The domain remains usable when your renderer or device is replaced.

| Your idea | Start here | First concrete step |
| --- | --- | --- |
| A calmer personal organizer | `examples/headless.mjs`, `packages/sdk/src/client.ts` | Query actionable tasks, render one node and its prerequisite links, offer an explicit complete action |
| A screen-reader or braille interface | `packages/core/src/observe.ts`, `examples/perception.mjs` | Read `summary`/`facts`, follow linear navigation IDs and map actions to device controls |
| An audio landscape | `cueFor`, `PerceptionAdapter` | Bind cues to stable IDs and local sounds, with text equivalents, opt-in output and a stop control |
| A physical desk display or tactile surface | `examples/perception.mjs`, `docs/TOOLS.md` | Provision a read-only connection, negotiate actual device capabilities, map semantic cues to the device |
| A room-scale or spatial organizer | `spatialAdapter`, reference map code | Render projected IDs, preserve a textual index, then add device-specific picking and comfortable movement |
| An agent work loop | `packages/tools/src/mcp.ts`, `docs/TOOLS.md` | Discover work, observe, read current versions and execute one bounded atomic batch |
| A different browser interface | `WorkClient`, `schemas/openapi.json` | Consume complete typed observations and query state from the local API; keep all work writes on that API |
| Company-specific workflow metadata | `WorkItem.extensions`, `docs/ARCHITECTURE.md` | Define a namespaced JSON schema, validate it in trusted code, preserve unknown namespaces on updates |
| A company platform | `WorkspaceStore`, role binding, domain contracts | Build a network host with real identity and a suitable store; keep the tested core semantics and perception boundary |

## A safe action binding

```js
// trusted service connection, or await the same calls on WorkClient
const snapshot = work.snapshot(workspaceId);
const item = snapshot.items.find(item => item.id === selectedId);
if (!item) throw new Error('This item is no longer available.');

work.execute(workspaceId, {
  schemaVersion: 1,
  requestId: yourStableIntentId,
  expectedRevision: snapshot.workspace.revision,
  commands: [{ type: 'item.update', id: item.id, expectedVersion: item.version, patch: { status: 'done' } }],
});
```

The visible action's enabled flag is an affordance, not authorization. The backend checks again. A conflict is a decision point for your interface. An uncertain transport result should be retried with exactly the same intent ID and body.

## Files to open first

- [Model and command union](../packages/core/src/model.ts)
- [Transition and graph invariants](../packages/core/src/transition.ts)
- [Semantic observation and navigation](../packages/core/src/observe.ts)
- [Runtime schemas](../packages/sdk/src/schemas.ts)
- [Service and storage contract](../packages/sdk/src/service.ts)
- [Perception profiles and adapters](../packages/sdk/src/perception.ts)
- [SQLite implementation](../packages/node/src/sqlite.ts)
- [HTTP host and OpenAPI assembly](../packages/server/src/index.ts)
- [Reference UI](../packages/reference/src/main.ts)
- [Storage conformance and durability tests](../tests/service.test.ts)

Custom hardware, hosted identity, recurrence and sync are intentional extension work. The bundled product stays personal-first and local-only; the contracts give those future layers a common base.
