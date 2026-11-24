---
name: solidworks
description: Create, edit, verify and export native SOLIDWORKS parts, assemblies, drawings and Visualize renders on Windows by driving the installed application through typed API jobs (the bundled SwKit helpers) and its native UI. Use for SOLIDWORKS modeling, parametric and configurable models, assemblies and mates, drawings, STEP/STL/PDF exports, Pack and Go or project relocation, automation recovery and photorealistic rendering; not for substituting meshes, screenshots or neutral files for required native CAD files or ray-traced renders.
---

# Work in SOLIDWORKS

Produce the requested editable CAD result and evidence that the saved files meet the source requirements. Work from the user's specification, original drawings and supplied native files. Use an existing work map when provided; this skill also works with an ordinary task brief and local files. Submission remains governed by the user's authorization and any requested review.

## Quick start

1. **Probe** the running session (read-only; prints installation, version and open documents):
   `powershell.exe -NoProfile -STA -File "<skill>/scripts/probe-solidworks.ps1"`. Use the bounded form in [automation.md](references/automation.md#bounded-jobs) when the application may be busy.
2. **Write** one stage of work as a C# job body against `scripts/lib/SwKit.cs`. Start from the skeleton and recipes in [cookbook.md](references/cookbook.md).
3. **Compile-check** it offline, without touching SOLIDWORKS:
   `powershell.exe -NoProfile -STA -File "<skill>/scripts/compile-check.ps1" -BodyPath "D:/private-work/job.cs"`.
4. **Run** it bounded with `scripts/invoke-solidworks-job.ps1 -JobPath "<skill>/scripts/jobs/run-csharp-job.ps1"` and an input JSON `{ "skillRoot", "bodyPath", "args" }` ([automation.md](references/automation.md#c-jobs-with-swkit)).
5. **Verify** the saved result against the source, then save, close and reopen ([verification-recovery.md](references/verification-recovery.md)).

On a new machine or SOLIDWORKS version, run `scripts/examples/smoke-tray.cs` once before real work. It builds, checks and closes a sample part and assembly in a scratch folder.

## Find the right reference

| When you need to                                                            | Read                                                                    |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Connect, run bounded jobs, write C# jobs, own a session, change preferences | [automation.md](references/automation.md)                               |
| Copy working code for a task                                                | [cookbook.md](references/cookbook.md)                                   |
| Look up arguments, selection marks, enums or return values of a call        | [api-quick-reference.md](references/api-quick-reference.md)             |
| Draw sketches, dimensions and relations                                     | [sketches.md](references/sketches.md)                                   |
| Create or edit features, bodies or materials                                | [features.md](references/features.md)                                   |
| Drive a model by parameters or build a family of variants                   | [parameters-configurations.md](references/parameters-configurations.md) |
| Assemble, mate, pattern components, explode, test motion, check clearances  | [assemblies.md](references/assemblies.md)                               |
| Make drawings, BOMs and balloons                                            | [drawings.md](references/drawings.md)                                   |
| Save, export STEP/STL, Pack and Go, relocate a project                      | [files-exports.md](references/files-exports.md)                         |
| Verify results, run interference, recover from a stall or crash             | [verification-recovery.md](references/verification-recovery.md)         |
| Render photorealistic images in SOLIDWORKS Visualize                        | [visualize.md](references/visualize.md)                                 |

## Rules that prevent most failures

1. The API takes metres and radians, whatever the document displays. SwKit takes millimetres and converts at its boundary.
2. A failed call usually returns null or false instead of throwing. Check every return, and check `GetErrorCode2` on every new feature.
3. Find planes, faces and edges by type and position, never by display name or index. Find them again after each feature and after a new document's first save, and name every feature you create.
4. Map model points into each sketch through `ModelToSketchTransform`. Create entities with `AddToDB` (slots also with inference off), and add dimensions with "Input dimension value" switched off so no modal box blocks the call. Confirm each dimension comes back driving.
5. Keep intent editable: one global variable per design quantity, equations naming the exact dimension owner, and variants as configuration-specific values rather than copies.
6. Do one stage per job, with the job and its input persisted and a deadline set. After a stall or timeout, inspect the application before any new call, and never resend blindly.
7. Verify against the source specification, not against the script's own constants. Check every required configuration.
8. Save, close and reopen before claiming success. Open packaged or relocated copies with no same-named originals loaded, and check the resolved paths.
9. Touch only documents the job created or opened, never discard others' unsaved work, and restore every preference you change.
10. When the kit lacks a call, read the installed API help for the exact signature, then compile-check before running.

## Establish the job

Identify required parts, assemblies, configurations, drawings, exports and dependent files. Inspect archive contents for embedded briefs as well as CAD components. Inspect the source figures at readable scale, including sections and small dimension symbols. Record the source pages and original file hashes. Determine units, dimensions, fits, tolerances and any required construction method. Resolve missing or conflicting requirements from authorized sources; do not turn a guessed measurement into a driving dimension.

Distinguish a specification that permits a chosen modeling method from an exercise that requires a feature sequence or tutorial. When walkthrough videos are supplied alongside drawings or transcripts, inspect the actual video steps for feature order, wall directions, hidden reference geometry and UI-only settings that summaries omit. A correct-looking result does not establish that the required method was used. Keep original files unchanged, make named working copies and retain failed attempts before replacing them. Store real work and traces privately when publishing reusable automation.

## Use the actual application

Read [automation.md](references/automation.md) for session discovery, installed typed interop and automation boundaries. Verify the actual running version, license readiness and working document identity. Prefer supported native APIs for precise geometry; use an available native computer-use skill for UI operations and visual inspection. Only one worker controls a SOLIDWORKS session at a time. Other workers may research sources or derive independent criteria offline.

Before a material operation, record its input identity, intended result and start time. After it returns, inspect the actual outcome and record the end/result. Use the bounded job launcher in [automation.md](references/automation.md), or an equivalent controller, to preserve the exact script and input and impose an actual deadline. A timeout, disappeared dialog or notification sound is not a successful calculation. Do not repeat a nonreturning call without diagnosis; follow [verification-recovery.md](references/verification-recovery.md).

## Model and document

Keep design intent editable: source dimensions and meaningful geometric relations, appropriate native feature types and deliberate component placement. Prefer fully defined construction sketches when practical; always satisfy an explicit fully defined requirement. Report remaining freedom instead of concealing it with indiscriminate fixed relations. Sketch, feature and assembly guidance is in [sketches.md](references/sketches.md), [features.md](references/features.md) and [assemblies.md](references/assemblies.md).

When a requirement varies between builds (clearance, offset, size), make it one configuration-specific global variable that drives every dependent feature and placement, as described in [parameters-configurations.md](references/parameters-configurations.md). Verify and export every configuration rather than editing copies.

Read [drawings.md](references/drawings.md) and [files-exports.md](references/files-exports.md) when drawings or portable packages are required. Native views, associated dimensions, sections and file dependencies are part of the result. Screenshots, neutral exports and a prose dimension list supplement required native files; they do not replace them.

Read [visualize.md](references/visualize.md) when photorealistic renders, appearances or decals in SOLIDWORKS Visualize are required. Verify active GPU/engine throughput, transparent-vessel geometry clearances, decal readability and actual output dimensions/DPI rather than substituting SOLIDWORKS viewport screenshots.

## Verify and deliver

Read [verification-recovery.md](references/verification-recovery.md). Check source-critical geometry, sketch state, feature errors, bodies/components, references and warning flags in the target application. Compare with the original specification, not only with constants from the generating script. Where independent review is warranted, derive its acceptance criteria from sources before inspecting the candidate.

Save, close and reopen the actual candidate files. Preserve full native quality and record exact output hashes. Test portable references from a separate extraction with no identically named candidate documents already open. Recheck only what an actual change or unresolved concern affects; an inspection helper must not silently run expensive assembly calculations on every open.

Provide a short review package with native files, required exports, readable previews, observed checks and limitations. Keep construction, technical verification, human approval, delivery and external acceptance distinct. An unresolved warning or missing required source remains visible. Restore temporary preferences, close only documents owned by this job after handling unsaved work, and release the session to the next worker.
