# SDK and local HTTP contract

API version: `/v1`. Domain and snapshot schema version: integer `1`. All public packages use ESM and ship TypeScript declarations and sources. Inputs are validated by the SDK in addition to TypeScript types. Unknown object fields are rejected. JSON Schemas are generated from the same runtime schemas; custom refinements and graph invariants still require runtime validation.

The source includes [OpenAPI with complete response schemas](../schemas/openapi.json), [command request schema](../schemas/command-request.schema.json), [snapshot schema](../schemas/snapshot.schema.json), and [perception profile schema](../schemas/perception-profile.schema.json). Regenerate with `npm run contracts`. Schema references are checked by the API tests.

## Connection operations

```ts
const service = new WorkService(store);
const work = service.connect(authenticatedActorId);
work.list();
work.create({ id: 'personal', title: 'My work' });
work.snapshot('personal');
work.role('personal');
work.execute('personal', request);
work.observe('personal', { query: { actionable: true }, offset: 0, limit: 100 });
work.events('personal', 0, 100);
work.export('personal');
work.import(snapshot, { id: 'new-workspace', title: 'Imported work' });
```

Methods are synchronous for the bundled memory and SQLite stores. The network `WorkClient` offers Promise-based equivalents except `role` (included in workspace listings). Only the trusted host chooses actor identities or grants roles. Owner and editor can mutate work; reader can observe and export. Membership administration belongs to the trusted store host, not either role's command API.

## HTTP

Send `Authorization: Bearer <token>` on every `/v1` request. Read the token from the private local token file in trusted native clients; never embed it in a URL, committed source or renderer metadata. The bundled browser's bootstrap keeps its token in memory. All responses and authentication errors are JSON.

| Method | Path after `/v1` | Request / response |
| --- | --- | --- |
| GET | `/workspaces` | Accessible `{id,title,revision,role}[]` |
| POST | `/workspaces` | `{id,title}` → initial state, HTTP 201 |
| GET | `/workspaces/:id` | Full workspace state and versions |
| POST | `/workspaces/:id/commands` | `CommandRequest` → `{revision,event}` |
| POST | `/workspaces/:id/observe` | `{query?,offset?,limit?}` → `Observation` |
| GET | `/workspaces/:id/events?after=0&limit=100` | `{events,nextCursor,revision}` |
| GET | `/workspaces/:id/export` | Portable versioned snapshot |
| POST | `/import` | `{snapshot,target:{id,title}}` → new state, HTTP 201 |
| GET | `/openapi.json` | Generated OpenAPI 3.1 contract |

`/health` is public and contains no work data. `/local/session` is a local reference-browser bootstrap, not a general integration API. See SECURITY.md.

## Commands

Every command is wrapped in:

```json
{
  "schemaVersion": 1,
  "requestId": "unique-intent-id",
  "expectedRevision": 3,
  "commands": [
    {"type":"item.update","id":"draft","expectedVersion":2,"patch":{"status":"done"}}
  ]
}
```

| Type | Fields |
| --- | --- |
| `item.create` | `item: {id,kind,title,description?,status?,priority?,tags?,effortMinutes?,dueDate?,schedule?,extensions?}` |
| `item.update` | `id, expectedVersion, patch` (nonempty; mutable item fields only) |
| `item.archive` | `id, expectedVersion, archived` (false restores) |
| `relation.add` | `relation: {id,kind,from,to}` |
| `relation.remove` | `id` |
| `view.save` | `view: {id,title,query,renderer}` (upserts by ID) |
| `view.remove` | `id` |
| `workspace.rename` | `title` |

IDs match `[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}`. Titles are trimmed and limited to 240 characters; descriptions to 20,000. Tags are unique, nonempty strings, up to 30 of at most 60 characters each. Effort is an integer from 0 through 525600 or null. Priority is 0–3. Extensions allow up to 30 namespaced keys and 16 KiB of JSON characters per item; the whole JSON structure is depth-limited to 20. Maximum command payload is 1 MB in the SDK and 1 MiB over HTTP. Unspecified fields receive defaults on creation; updates preserve omitted fields. Explicit null clears effort, deadline or schedule. Setting `extensions` replaces that map, so read/merge locally before updating it.

`schedule: {start,end,timeZone}` uses canonical UTC instants, e.g. `2026-09-08T10:00:00.000Z`, and an IANA zone such as `Europe/Helsinki`. The API never guesses a time zone or resolves an ambiguous wall-clock time.

## Queries and navigation

`Query` fields: `text`, `statuses`, `kinds`, `tags`, `parentId`, `actionable`, `scheduled`, `archived`, `dueBefore`, `sort`.

- Text is case-insensitive, whitespace-separated AND search over title, description and tags. All requested tags must match. Empty status/kind/tag arrays impose no filter.
- `actionable: true`: unarchived-by-default unfinished tasks with no unfinished prerequisites. Inbox tasks can be actionable. This does not impose a schedule window or automatically rank effort.
- `scheduled: true`: items with an explicit scheduled interval, regardless of kind. False returns items without one.
- `parentId`: direct children only. `archived` defaults to false. `dueBefore` includes the given calendar date.
- Sort is `priority` (descending, default), `due` (ascending, null last), `updated` (descending) or `title` (case-folded code-unit order). Ties use stable ID order. No locale-dependent sort is hidden in the core.
- Observation pages have `total`, `offset`, `nextOffset` and the workspace revision. Navigation previous/next crosses page boundaries in the same ordered query. A cursor is only coherent for its revision; refresh after edits.

Each node carries `id`, `label`, `kind`, text `summary`, labeled typed `facts`, two-way relationship navigation, semantic actions with disabled reasons, and parent/child/prerequisite/previous/next IDs. Commands still require a fresh workspace snapshot and item version. Actions are descriptive affordances, not bearer capabilities; the service rechecks authorization and invariants on every write.

## Errors and retries

```json
{"error":{"code":"CONFLICT","message":"Workspace changed. Refresh before applying your changes.","details":{"currentRevision":4}}}
```

`VALIDATION` → 400; `UNAUTHORIZED` → 401; `FORBIDDEN` → 403; unavailable workspace/item → 404; stale version, duplicate ID or request-ID collision → 409; `CYCLE`/`BLOCKED` → 422; `LIMIT` → 413. Rate limiting returns HTTP 429. Unexpected errors return a generic HTTP 500 with no database paths, stack or token.

On network uncertainty, retry the **exact same request ID and payload**. `WorkClient.execute` performs one such retry automatically on transport/parse failure. It does not retry domain errors. If both attempts fail, retain the request and reconcile after reconnection. Never change the expected revision under the same request ID. Workspace creation and import are not automatically retried; chosen stable IDs prevent accidental overwrites.

Events are durable, ordered, workspace-local and one per committed batch. This release provides polling, not SSE or webhooks. Consumers checkpoint `nextCursor` after successful processing. Imports start a new revision/event sequence; historical events and identities are not transplanted.
