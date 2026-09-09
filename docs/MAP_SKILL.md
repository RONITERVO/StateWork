# Build work from original records

The [StateWork Map Builder](../.agents/skills/statework-map/SKILL.md) is a reusable Codex skill, maintained with the app's contracts. It creates a local workspace from original emails, project folders, portals and documents. Give it a starting source and the outcome you need. It researches the records, maps requirements, stores original files and prepares short linked actions with explicit blockers.

## Install and start

In a checkout, the skill lives at `.agents/skills/statework-map` for repository discovery. To use it across projects, copy that complete folder into the user skills directory used by your Codex installation, commonly `~/.agents/skills` in current Codex documentation. Some desktop installations expose `~/.codex/skills`; use the location shown by that installation. Start a fresh session and invoke `$statework-map`, or reference the exact `SKILL.md` path if it has not yet appeared in the skill list. Skill folders support progressive discovery through their metadata and supporting references. [Official Codex customization documentation](https://learn.chatgpt.com/docs/customization/overview#skills).

Example:

> Use $statework-map to build my work map from the project folder and the client emails. Read the original records yourself. Ask for short access or choice confirmations when necessary. Keep unresolved requirements visible and do not perform the work yet.

No previous chat, personal database, model output or example map is needed. If StateWork is absent, the skill installs from the public repository and creates a new private data directory. An existing MCP connection is useful; the local CLI/SDK also works without changing Codex settings. Source-system access still requires the person's authorized account and available tools.

## What the skill produces

- A real StateWork workspace with project groups, deliverables, dependencies and evidenced historical records.
- Connected packets containing exact inputs, ordered/parallel/conditional actions, result checks, recovery links and acceptance criteria.
- Original file bytes plus readable captures and exact provenance.
- A private research ledger, contemporaneous trace and complete workspace bundle.
- A machine audit and an app-only worker dry run, followed by a short list of actual unresolved needs.

The person supplies choices and access that records cannot establish. They should not need to transcribe source instructions or reconstruct dates and tasks from memory. Permission to research does not imply permission to submit work, enroll, send messages or change external records.

## Auditing and privacy

The bundled Node auditor imports a supplied bundle through StateWork into memory. It checks discovered-link accounting, requirement-to-item mappings, supporting quotes, completion evidence and every task's backend handoff with external access disabled. It cannot discover requirements the researcher failed to inventory or establish the semantic correctness of a procedure. Review the original indexes and perform the skill's dry run as well.

All real research artifacts stay private. Source captures may contain personal information and access-bearing URLs; neither the skill nor its audit report is a content-redaction service. The source release contains only the generic skill and fictional automated tests, not private maps, tokens, research captures or evaluation transcripts.

## Independent evaluation and limits

Fresh agents received the copied skill, a minimal work request and original sources. They were instructed not to read an existing map, earlier conversations or evaluation answers. Separate app/data directories prevent accidental map reuse; the shared host is instruction-level isolation, not an enforced security sandbox. Private proof includes contemporaneous tool transcripts, source ledgers, frozen bundles and file digests. Baseline comparison happens after candidate freezing, and the baseline is not treated as ground truth.

The [fictional source pack](../examples/map-skill-sources/index.md) exercises two required deliverables, a missing drawing sheet, an inaccessible delivery source, a notice for a different team, optional work and an accepted historical record. The initial independent trial retained the six supplied originals byte-for-byte, accounted for 22 discovered requirements, kept the correct team's deadline and blocked missing geometry. Actual desktop/narrow views and a shortened day were inspected. Semantic review found that an uninspected delivery procedure had been conflated with account access; the skill now requires distinct knowledge/access blockers and permits separate preparation and delivery packets.

Real-source research in a separate fresh installation also exposed authenticated-download limitations and a collection exceeding the bundled file capacity. The parent assisted with original-byte transport after a user sign-in; the mapping agent interpreted the records independently. This is an assisted blind trial, not a claim that every browser tool or fresh installation can access every source unaided. The skill now calls for download verification, capability fallbacks, size inventory and explicit derivative lineage or storage blockers. Raw real-work sources, maps and transcripts remain private.

The trials also exposed misleading Ready labels in next actions and planning. Those views now use packet review, current-step readiness and actual file availability. Conditional planning preserves projected prerequisite completion without changing real task status, checks or access. Unit and browser regressions exercise these boundaries; the machine auditor still cannot establish semantic completeness.

Use this skill for researched map construction and reviewed handoffs. A discovered-but-blocked requirement is useful evidence, not executable work. The bundled host allows 64 MiB per file and 256 MiB of unique file bytes per workspace; essential inputs beyond those limits require a suitable storage integration or an explicitly inspected task-specific derivative. Physical app operation, source-system permissions, unstated requirements and professional judgment remain outside what a map audit can guarantee. A small test cannot establish universal completeness or autonomous completion of every occupation.
