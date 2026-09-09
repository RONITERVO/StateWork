# Execute mapped work with Codex

[StateWork Execute](../.agents/skills/statework-execute/SKILL.md) works from an existing map. It finds a suitable task, obtains its exact instructions and files, uses the required working application, checks the saved result and prepares evidence for review. [StateWork Map Builder](MAP_SKILL.md) handles discovering and organizing the broader work; the execution skill can research and repair a selected task's missing details within the user's authorized scope.

The skill is instruction guidance for Codex, not a new autonomous service. It does not grant access to applications or accounts, replace their permissions, or make unavailable specifications complete. The backend's handoff, revision checks and execution graph remain authoritative for recorded work.

## Start a fresh task

The repository contains the complete skill at `.agents/skills/statework-execute`. Use it from this checkout or copy that entire folder into the user skills directory supported by your Codex installation. If it has not appeared in the skill list, reference its exact `SKILL.md` path. It works with an existing StateWork MCP connection or the local CLI/SDK; changing Codex configuration is optional.

Provide the workspace or its private connection note and the scope of work:

> Use $statework-execute on my StateWork workspace. Check today's priorities, complete the next design task, and prepare the native files and preview for my review. Do not submit yet.

Or resume a known task:

> Use $statework-execute to resume task `<task-id>` in workspace `<workspace-id>`. Read the current results and continue from them. Research missing instructions from the authorized original sources instead of asking me to remember them.

Keep the app directory, absolute data directory and workspace ID in a private connection note. A browser tab or copied handoff cannot create a working MCP connection or transfer another worker's login. Preserve any configured restricted identity rather than falling back to owner access.

## Results and review

The worker produces the actual editable/native result, required exports, a concise preview and acceptance evidence. It records input identities, packet revision, app version, original and result hashes, checks, failures and recovery. It reopens saved outputs in the required application rather than treating generated code or file existence as success.

Instruction review (`packet.review`) establishes the procedure. Artifact verification checks the produced result. Human review approves that exact version. Submission and external acceptance are separate observed events. The skill keeps these distinctions even when the app's basic task status is only ready, active or done.

When review is requested, the worker stops with a concrete review package. Approved files may be submitted only within the user's actual authorization; source text that says “upload” does not authorize an external action. Changed output bytes need review of the change. An uncertain delivery is inspected at the destination before retrying. A task with a delivery-dependent finish remains unfinished until that finish is observed.

Private originals, outputs, credentials and process traces stay outside the published source repository. Publish only the reusable skill and fictional examples. A successful example is evidence for its tested scope, not a guarantee that every task or application can be completed autonomously.

## Repeat the fictional evaluation

The [fixture generator](../examples/execution-skill-workspace.mjs) creates a portable workspace with original UTF-8 input, an active priority task, a later optional task and a review-dependent local delivery step. It uses no personal data or network destination.

After building StateWork, create a new bundle with `node examples/execution-skill-workspace.mjs <new-bundle.json>`. Import it with `node packages/tools/dist/cli.js bundle-import <new-bundle.json> <new-workspace-id> "Fictional execution trial"`, setting `STATEWORK_HOME` to a separate absolute evaluation directory. Never point this evaluation at a personal work database. The reference planning date is 9 September 2026; use the exported `fixtureNow` when reproducing that exact planning scenario.

Give a fresh worker only the copied skill, private connection details, a new run directory and this request:

> Use the execution skill to find the priority task, produce and verify its result, and stop for independent review before delivery. This is fictional local work. Do not read the fixture generator, tests, earlier runs or evaluation answers.

Assign a separate reviewer. Inspect the exact attached output against the original specification before supplying the requested approval artifact and authorizing the fictional local copy. Then resume the worker and verify the delivered bytes, receipt and final task state. Shared-host isolation depends on the worker following those instructions; it is not a security sandbox. The approval record preserves review evidence; it is not an authenticated reviewer access-control mechanism.

The [automated tests](../tests/execution-skill.test.ts) exercise priority, original byte preservation, real local output, required artifact bindings, blocked delivery/completion before review, worker-scoped confirmation, receipt-dependent completion and portable import. Automated contract tests supplement the fresh-agent trial; they do not establish that a worker interpreted an arbitrary real specification correctly.

## Observed evaluation and limits

A fresh agent received the frozen skill, private fixture connection and task request, without the generator, tests or earlier answers. It selected the priority task, produced the correct 76-byte file, checked every row and stopped with delivery blocked. A separate reviewer independently checked the original specification and exact output bytes, then approved that hash and fictional local destination. On resume, the worker rechecked the approval, delivered unchanged bytes, recorded the observed receipt and completed the task. Independent readback confirmed the final bytes and state; the unrelated task remained unchanged.

Contract review also corrected three details: branch choices use `choice`, attachments have their own request/retry contract, and review progress belongs in attached artifacts rather than new task source captures that would invalidate the reviewed procedure. Frozen attempts and contemporaneous evidence stay private. These findings refine the reusable guidance; they do not imply that every application or specification is covered by this small trial.

An independent real CAD attempt exposed a different failure: native models and drawing files existed, but the first drawing draft substituted a prose dimension list for dimensioned views and omitted needed sections. Review rejected that draft. The CAD reference now explicitly requires the drawing's own associated dimensions, geometry-revealing views and clean annotations. This is why file existence, a successful save and an agent's completion claim cannot replace source-based artifact review.

That CAD trial produced three private review candidates: two native sketch exercises and a three-part assembly with native drawings and a portable package. A reviewer derived criteria from the original specifications before opening the candidates, then independently confirmed both sketches' geometry, driving/reference dimensions, plane and fully defined state. The assembly retained a documented rebuild-on-open warning despite successful rebuild/save attempts; the guidance now requires explicit warning diagnosis and disclosure. Stale task summaries also prompted a rule to keep the visible map consistent with verified progress. The CAD trial included corrective parent review and skill revisions, so it is evidence of an assisted workflow, not an unassisted first-attempt pass. No coursework submission or teacher acceptance was claimed.
