# Connected work: release requirements

StateWork must retain enough explicit, inspectable work context for a person or a newly connected agent to continue without relying on an earlier conversation. The reference experience remains personal and local. Organizations can supply their own identities, stores, assistants and domain rules through documented contracts.

## Acceptance contract

1. **Evidence travels with work.** Preserve original input files, including drawings and binary CAD files, with content digests, immutable metadata and source provenance. Authorized clients can retrieve exact bytes. Text extraction never substitutes for the original. Portable exports include a manifest and explicitly distinguish missing bytes from available files. Existing databases, snapshots and packets remain readable.
2. **Short views, precise references.** Each action can point to captured text, an attached file, an exact page/section/time, or an external destination. Stable deep links reopen the same task and step. Essential external-only references block an isolated worker. Links never imply access, ingestion or authorization.
3. **A real execution graph.** Support ordered, parallel and explicitly selected conditional paths; detect unknown edges and cycles. Separate preparation, production, verification and delivery. Review establishes procedure quality; per-step readiness establishes whether this worker can act. An unavailable delivery account must not prevent independently ready production work.
4. **Evidence and decisions are durable.** Record attributed prerequisite confirmations, branch decisions, step result evidence and output files. Undo invalidates dependent results, preserves history and reopens finished work. Required outputs and acceptance checks gate completion. Drafts, uncertain instructions and skipped branches cannot silently become successful work.
5. **A fresh worker can resume.** Provide one versioned handoff through SDK, HTTP, CLI and MCP: task identity and revision, graph, ready actions, specific blockers, precise references, input/output manifests, current evidence and allowed next commands. Access remains bound to the authenticated actor. Include a portable human/agent brief and tested connection instructions.
6. **Assistance is replaceable and honest.** Existing optional in-app assistance and external agents use the same contracts. Validate proposals against actual source and work IDs before presenting them. Remove invented references into explicit unresolved questions, reject cycles, and never manufacture specifications or approval. Missing evidence produces a compact preparation path, not a plausible production procedure.
7. **A usable daily interface.** Provide a compact, keyboard-accessible map and one current action, accessible states beyond color, direct reference buttons and one-click confirmations. Mobile and VR retain a text fallback. Authoring must expose the new contracts without requiring JSON. Short printouts lead with the next action/blocker; full evidence is an explicit appendix.
8. **Release evidence.** Test isolated-worker fixtures for CAD, office work and a conditional physical workflow; missing assets/access, changed sources, malicious input, conflicting edits, cross-workspace permissions, backup/restore, graph/undo and compatibility. Inspect rendered desktop/mobile/print/VR behavior. Run repository checks and release packaging, open a PR against the merged main branch, and verify its final checks before recommending merge. Do not publish private study data or perform coursework.

## Implementation principles

- The pure core owns work semantics; no model, display, file path, credential or application automation is required by the domain.
- Stored resources are data. Referenced documents do not grant permissions or override a worker's instructions. Opening a resource and executing an action remain distinct operations.
- Files are stored separately from ordinary workspace snapshots and event payloads, using a host storage contract. The bundled SQLite host includes them in database backups. Portable transfer must account for every referenced digest.
- Old linear packets retain their behavior. A versioned execution contract opts into graph and worker-specific readiness semantics, allowing gradual migration.
- Completeness means every declared input, requirement, output and check is accounted for. It does not claim omniscience about unstated real-world requirements or universal autonomous execution.

## Completion ledger

The release PR must link concrete implementation and validation evidence for each numbered requirement above. Passing legacy tests alone does not prove this contract.
