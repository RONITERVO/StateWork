# The backend is the product

StateWork stores meaning independently of presentation. No coordinate, sound, display color or motor gesture is needed to identify work, read its status, navigate its relationships or execute a command. The reference browser is one consumer of the same contracts used by a terminal and an MCP client.

## Boundaries

`core` has no imports outside itself and no filesystem, network, timer, UI or third-party dependency. `transition(state, request, actor, at)` is a pure transition for **already validated inputs**. It returns a new state and one batch event. Given the same inputs, it produces the same output. IDs, actor identity and timestamp are explicit; no clock or random generator is hidden in the transition. It clones JSON data and never retains caller-owned references.

`sdk` is the public untrusted-data entry point. It validates strict versioned schemas, bounds JSON nesting and batch sizes, binds a connection to a host-provided actor, validates imports, coordinates transactions and deduplicates requests. `WorkService.connect(actorId)` is trusted host provisioning, not an authentication mechanism. A browser cannot submit `actorId` or `role` in command JSON.

The store returns the connection's actual workspace role inside the same transaction that reads and writes state. The HTTP host derives identity from a hashed bearer token. CLI and MCP use the filesystem owner's local connection unless given an explicitly provisioned token. Neither exposes an operation that grants itself membership.

The reference app consumes `WorkClient` and the same semantic adapter package. HTTP exposes validated operations, not raw SQL. Native and embedded consumers can use the service without running HTTP.

## Work graph

Items have a kind (`task`, `project`, `note`, `event`), status (`inbox`, `ready`, `active`, `done`, `cancelled`), priority 0–3, description, tags, optional effort, optional date-only deadline, optional scheduled interval, namespaced JSON extensions, archive flag and item version.

- `depends_on`: `from` requires `to`. The dependency graph is acyclic. A done item cannot have an unfinished prerequisite. A cancelled prerequisite is treated as resolved. An archived unfinished prerequisite still blocks completion. Reopening a prerequisite of a completed item requires reopening its completed dependents in the same batch, or first removing the dependency.
- `contains`: `from` is parent of `to`. One parent per item, no cycles. A project's status does not automatically roll up from its children; containment is organization, not an implicit dependency rule.
- `relates_to`: a directed, labeled reference for data storage; observers offer navigation from either endpoint. Reference cycles are allowed. A reverse reference is a separate edge. Self-links and duplicate directed edges are rejected.

Completed-state invariants are checked after the whole batch, allowing dependent and prerequisite changes together in any order. Item-version checks are sequential within a batch, so two updates of one item must use consecutive versions.

Archive is reversible, retains IDs and edges, and is the default user-facing removal mechanism. No hard delete is implemented. Custom item kinds, statuses and commands would be a domain-contract extension; arbitrary JSON does not silently change built-in rules.

## Durable commands and conflicts

Each workspace has an integer revision. Every successful nonempty batch increments it exactly once. Commands carry `expectedRevision`; item edits also carry `expectedVersion`. No automatic last-writer-wins merge occurs. A caller refreshes, resolves intent and submits a new request after conflict.

Receipts are keyed by workspace, actor and request ID. The fingerprint is a canonical representation of the entire validated request, including expected revision. An exact retry returns the original result even after later commits. Reusing the ID for different content is a conflict. Membership and write permission are checked before serving a retry, so revoking write permission takes effect immediately.

The SQLite adapter uses `BEGIN IMMEDIATE`, foreign keys, WAL, a 5-second busy timeout and `synchronous=FULL`. Snapshot, receipt and event are committed together. A callback failure rolls all of them back. Multiple local processes serialize through SQLite. A database created with a newer schema is rejected. Migration 1 is transactional and recorded in `PRAGMA user_version`.

The durable representation is a **bounded workspace snapshot** plus append-only events, receipts and membership tables. A transaction loads a whole workspace. This makes the pure domain portable and recoverable but is not intended as a high-volume company database. Limits: 10,000 items, 30,000 edges, 100 saved views; 100 commands per batch, 500 observation/event records per page. The server accepts bodies up to 1 MiB. Events and receipts are not pruned automatically. Storage and graph processing grow with workspace size; measured examples are in acceptance evidence.

## Time

Due dates are validated real `YYYY-MM-DD` calendar dates. They never become midnight in an implicit zone. A scheduled interval uses canonical UTC instants (`YYYY-MM-DDTHH:mm:ss.sssZ`) plus an IANA display zone. End must follow start. Explicit instants avoid ambiguous or nonexistent local DST times; adapters accepting wall-clock time must resolve that ambiguity before submitting. Date-only deadlines and scheduled intervals are independent. Display zones do not move stored instants.

No deadline timer mutates state. The UI and adapters choose how to highlight or announce dates. Recurrence, capacity scheduling, reminders, calendar sync and background jobs are extension work, not hidden behavior.

## Extension seams

1. **Presentation and input:** implement `PerceptionAdapter<T>`, consume stable observations and dispatch validated commands. Use explicit capability negotiation and text fallback.
2. **Storage:** implement `WorkspaceStore` and its synchronous atomic transaction contract. Run the adapter conformance tests. An asynchronous or distributed database requires a deliberate new service/adapter interface, not promises hidden inside this synchronous callback.
3. **Business metadata:** keep data under a namespaced key such as `example.org/capacity` in `item.extensions`. Unknown namespaces survive export/import unchanged. Define and validate your own schema in trusted application code. They never load or execute code.
4. **Identity/hosting:** provide authenticated actor binding and workspace membership through a trusted host. The bundled server intentionally remains loopback-only. A company deployment requires a new hardened host, identity integration and a workload-appropriate store.
5. **Integrations:** read the durable event feed using its workspace-local cursor; checkpoint only after successful processing. Use deterministic request IDs when submitting integration results. Keep external credentials outside work extensions and exports.

Cross-device sync, CRDTs, networked collaboration, multi-process event push and distributed locks are not claimed. A developer can build these around the versioned contracts while keeping modality-independent semantics.
