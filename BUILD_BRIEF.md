# StateWork foundation

Owner direction: a work counterpart to D:/Projects/3dRythm (StateBeats). The backend is the product. Developers must be able to build different perception and interaction layers for personal or company use. The owner clarified **personal-first, local-only organization**. The owner will publish to GitHub later; nothing is to be published as part of this build.

## Delivery boundary

A usable local work organizer and a documented, tested developer foundation: dependency-free deterministic domain, versioned validated commands, atomic SQLite persistence, caller-bound permissions, optimistic concurrency, durable idempotency, history/export, semantic observations/navigation, perception adapter contract, local HTTP API/OpenAPI, typed browser client, CLI and MCP, plus an accessible reference interface. No account, external service, telemetry, cloud storage, or AI dependency. Multiple workspaces separate personal contexts. The server binds to loopback only.

Core work semantics: tasks/projects/notes/events, status, tags, priority, effort, date-only deadlines, UTC scheduled intervals with IANA display zones, parent/dependency/reference edges, saved queries. Date-only deadlines are deliberately not coerced to midnight. Dependency cycles and completion with unfinished prerequisites fail atomically. A batch is all-or-nothing.

Every observation has stable IDs, text labels, facts, relationships and legal actions. Presentational coordinates, sound and haptic mappings are adapters, never required domain data. Text, list, board, timeline and spatial relationship views demonstrate the contract. Preferences describe capabilities and preferences, not diagnoses. No claim that every disability or device has been validated.

## Non-goals for this release

Hosted identity/SSO, online collaboration, device synchronization/CRDTs, email/calendar connectors, automated recurring schedules, reminders that run while the server is stopped, native XR or braille/haptic hardware drivers. Define extension seams and honest limits rather than simulate these features.

## Acceptance

Install/build/check; deterministic core and invariant tests; durable retries and crash-safe transaction tests; scoped permissions and isolation; API and real MCP transport checks; browser workflows, keyboard/reflow/reduced-motion and automated accessibility checks; packaged SDK/CLI smoke test; runnable examples; architecture/API/extension/security/backup/release documentation. Record actual evidence and remaining device testing separately.
