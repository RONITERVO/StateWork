---
name: solidworks
description: Create, modify and verify editable SOLIDWORKS parts, assemblies and drawings from supplied requirements using the installed application, its supported API and native UI. Use for SOLIDWORKS modeling, drawing, packaging or automation recovery; not for substituting meshes or images for required native CAD files.
---

# Work in SOLIDWORKS

Produce the requested editable CAD result and evidence that the saved files meet the source requirements. Work from the user's specification, original drawings and supplied native files. Use an existing work map when provided; this skill also works with an ordinary task brief and local files. Submission remains governed by the user's authorization and any requested review.

## Establish the job

Identify required parts, assemblies, configurations, drawings, exports and dependent files. Inspect archive contents for embedded briefs as well as CAD components. Inspect the source figures at readable scale, including sections and small dimension symbols. Record the source pages and original file hashes. Determine units, dimensions, fits, tolerances and any required construction method. Resolve missing or conflicting requirements from authorized sources; do not turn a guessed measurement into a driving dimension.

Distinguish a specification that permits a chosen modeling method from an exercise that requires a feature sequence or tutorial. A correct-looking result does not establish that the required method was used. Keep original files unchanged, make named working copies and retain failed attempts before replacing them. Store real work and traces privately when publishing reusable automation.

## Use the actual application

Read [automation.md](references/automation.md) for session discovery, installed typed interop and automation boundaries. Verify the actual running version, license readiness and working document identity. Prefer supported native APIs for precise geometry; use an available native computer-use skill for UI operations and visual inspection. Only one worker controls a SOLIDWORKS session at a time. Other workers may research sources or derive independent criteria offline.

Before a material operation, record its input identity, intended result and start time. After it returns, inspect the actual outcome and record the end/result. Use the bounded job launcher in [automation.md](references/automation.md), or an equivalent controller, to preserve the exact script and input and impose an actual deadline. A timeout, disappeared dialog or notification sound is not a successful calculation. Do not repeat a nonreturning call without diagnosis; follow [verification-recovery.md](references/verification-recovery.md).

## Model and document

Read [modeling.md](references/modeling.md) when creating or editing sketches, features and assembly relationships. Keep design intent editable: source dimensions and meaningful geometric relations, appropriate native feature types and deliberate component placement. Prefer fully defined construction sketches when practical; always satisfy an explicit fully defined requirement. Report remaining freedom instead of concealing it with indiscriminate fixed relations.

Read [drawings-packages.md](references/drawings-packages.md) when drawings or portable packages are required. Native views, associated dimensions, sections and file dependencies are part of the result. Screenshots, neutral exports and a prose dimension list supplement required native files; they do not replace them.

## Verify saved results

Read [verification-recovery.md](references/verification-recovery.md). Check source-critical geometry, sketch state, feature errors, bodies/components, references and warning flags in the target application. Compare with the original specification, not only with constants from the generating script. Where independent review is warranted, derive its acceptance criteria from sources before inspecting the candidate.

Save, close and reopen the actual candidate files. Preserve full native quality and record exact output hashes. Test portable references from a separate extraction with no identically named candidate documents already open. Recheck only what an actual change or unresolved concern affects; an inspection helper must not silently run expensive assembly calculations on every open.

Provide a short review package with native files, required exports, readable previews, observed checks and limitations. Keep construction, technical verification, human approval, delivery and external acceptance distinct. An unresolved warning or missing required source remains visible. Restore temporary preferences, close only documents owned by this job after handling unsaved work, and release the session to the next worker.
