# Start small, keep the evidence

StateWork's compact entry point is a live projection of the work graph. It does not store a second summary that can drift away from the task. The same response serves the visual **Work overview**, SDK, HTTP, CLI and MCP. No AI or calendar account is needed.

## Fresh human or agent

1. Discover accessible workspaces. Call `work_brief` with a title, item ID or source URL in `options.text`, or open `/brief/`. Choose the actual workspace and work item; never assume the first search result is the user's intended task.
2. Read a brief for `options.taskId`. It supplies the next ready action, blockers, source freshness and a page of related work or facts. Project briefs can point to actionable direct children. It does not manufacture a ready procedure for unmapped tasks.
3. Call `work_step` for the chosen step. Read its full instructions, prerequisites, acceptance checks, recovery, original-file references and actor-specific readiness. A short label is not the specification.
4. Use `work_source_read` and existing original-file tools for the evidence. Source reads return exact text, not heuristic HTML cleanup, in ranges of at most 16,000 UTF-16 code units (4,000 by default). Follow `nextOffset` until the relevant content is read. Inspect original figures too. Existing `work_source` and `work_handoff` remain available for complete reads.
5. Record authorized work through existing atomic commands. Refresh before a new action. A brief/step never authorizes external submission.

All brief sections paginate (8 rows by default, maximum 20). Use `expectedRevision` from the first response for subsequent pages, source ranges and steps. Changed work returns a conflict instead of mixing revisions. The sections are `overview`, `steps`, `sources`, `facts`, `questions`, and `calendar`. Exact fact, verification and calendar records can be loaded with `work_record`.

Default source lists include explicit packet sources, direct task associations and fact evidence. `includeInherited:true` adds shared project/prerequisite sources. This changes discovery only: it cannot remove a real prerequisite or clear an execution blocker. Historical records are not discarded to make an answer smaller.

## Evidence currency and associations

`source.relink {id, taskIds, reason}` repairs organizational associations without changing exact captured text, original files, source identity or capture attribution. The command history retains the change; existing citations still resolve. Removing a source from a task's context can invalidate a packet review, which must be reconciled normally. Do not automatically classify sources merely from filenames or a generic intake bucket.

`source.verify {verification}` appends a host-attributed observation: ID, source ID, observation time, explicit validity end, result (`unchanged`, `changed`, `unavailable`) and evidence. Checking a source does not refresh its capture timestamp. Unverified captures remain **historical**, even if captured today. A verification has a finite, explicitly selected validity period; after it expires, the brief says **needs-check**. There is no background web monitor or universal expiry period.

Known changed/unavailable sources block affected packet execution until resolved. An expired observation is a currency warning, not a declaration that timeless geometry is wrong. Replaced sources are **superseded**. Historical source knowledge and current application/account access remain separate.

## Progress facts and decisions

`fact.record {fact}` records `chosen`, `attended`, `submitted`, `accepted` or `decision`. Each fact has a stable item/key/kind subject, value, actual occurrence time, source IDs and a nullable `replaces` identity. A correction must name the latest fact for that subject. Earlier facts remain available. The host supplies recording actor and time. Future occurrence times, missing evidence and conflicting correction chains are rejected.

Facts are observations, not new universal task statuses. Scheduling never records attendance; submission never records acceptance. Facts do not automatically mark work done, confirm access, rewrite procedures or satisfy arbitrary prerequisite rules. Review the supporting evidence before relying on a fact. Event history and snapshot/bundle exports preserve these records. Old snapshots without `knowledge` still load; older clients that reject this additive field need upgrading before opening snapshots containing it.

## Calendar reconciliation

`calendar.record {binding}` stores one observed provider identity: provider, calendar ID, event ID, concurrency token, observation time, source evidence, normalized baseline and optional stop condition. Updates keep the same identity and cannot move backwards in observation time. Duplicate remote identities are rejected. Old `statework.calendar/*` extension records remain visible as legacy evidence and require provider verification before adopting a binding.

`work_calendar_compare` compares a desired event and a fresh provider observation with that baseline. It returns **in-sync**, **update-remote**, **review-remote**, **conflict**, **remote-missing**, **stop-series**, **cancel-event** or **stopped**. Both sides changing produces a conflict unless their resulting fields agree. A stop condition matches a specific current evidenced fact; a changed remote event still needs conflict review. Recurring reminders and single events have distinct stop proposals. A missing event is never automatically recreated.

The adapter owns normalization (including recurrence order/canonical strings), provider-specific fields, all-day multi-day representation, recurrence exceptions and provider API calls. The v1 intent covers a timed event or one all-day date, title, direct action URL and normalized recurrence lines; do not use it to overwrite unsupported fields. Reconciliation is pure: it makes no Google/Microsoft calls. Before an authorized write, reread the remote event, use its concurrency token, preserve unmanaged fields and apply the chosen change. Read back success and then record the new baseline. `stop-series` means stop future occurrences while preserving historical records, not delete the whole series. An adapter must also check the workspace revision/stop fact before acting. A proposal does not authorize a write.

## Interfaces

| Purpose | HTTP (under `/v1`) | CLI |
| --- | --- | --- |
| Discover/brief | POST `/workspaces/:id/brief` | `brief <workspace> [options.json]` |
| Exact action | POST `/workspaces/:id/instructions/:task/steps/:step` | `step <workspace> <task> <step> [options.json]` |
| Source range | POST `/workspaces/:id/sources/:source/read` | `source-read <workspace> <source> [options.json]` |
| Exact record | GET `/workspaces/:id/records/:kind/:record` | `record <workspace> <facts|verifications|calendars> <record>` |
| Compare calendar | POST `/workspaces/:id/calendar/compare` | `calendar-compare <workspace> <comparison.json>` |

All reads require workspace membership; reader connections cannot record facts or checks. Reads do not increment revisions or write events. Each knowledge collection is bounded at 10,000 records. Existing snapshot, command and request limits still apply. Credentials stay outside records and exports. The original full handoff and all existing execution gates remain available.
