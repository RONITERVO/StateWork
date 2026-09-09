# Create and verify native SOLIDWORKS work

The [SOLIDWORKS skill](../.agents/skills/solidworks/SKILL.md) guides a Codex worker through source inspection, editable modeling, associated drawings, portable packages and verification in the installed desktop application. It works from ordinary briefs and files, or alongside [StateWork Execute](EXECUTION_SKILL.md) when the job comes from a work map.

## Use it

Use the skill from this checkout, or copy the complete `.agents/skills/solidworks` directory into the user skills directory supported by your Codex installation. Keep its `references` and `scripts` folders together. In a fresh session, invoke `$solidworks` or reference the copied `SKILL.md` directly.

> Use $solidworks to build this design from the attached brief and original files. Preserve editable native features, verify the saved result and prepare a short review package. Research missing instructions from the sources I have authorized. Do not submit yet.

For mapped work:

> Use $statework-execute with $solidworks to complete the next authorized CAD task in my workspace. Read its original drawings and required procedure, then prepare the exact native files for review.

The worker needs a usable Windows desktop SOLIDWORKS installation and license, the task's original inputs, and an available supported API or native computer-use capability. The skill does not install or license SOLIDWORKS, supply a remote desktop, transfer another person's sign-in, or run an autonomous background service. Only one worker controls a native session at a time; other workers can research sources independently.

## Read-only connection helper

With the intended SOLIDWORKS instance already running, create a private JSON input file with `skillRoot` set to the absolute installed skill directory. Run the supplied probe job under its controller deadline:

```text
powershell.exe -NoProfile -STA -File "<skill>\scripts\invoke-solidworks-job.ps1" -JobPath "<skill>\scripts\jobs\probe-session.ps1" -InputJsonPath "<private>\probe-input.json" -RunDirectory "<private>\new-probe-attempt" -TimeoutSeconds 30
```

The helper requires **64-bit Windows PowerShell 5.1**, the same user/session and integrity level as SOLIDWORKS, and the matching installed interop assemblies. It rejects an absent or ambiguous running instance and unsupported runtimes. It returns JSON with the process, installation, API version and current documents, or a JSON error retaining native error details. It compares two document observations and rejects observed changes; it does not lock the session. It does not launch the application, open or save documents, rebuild geometry or calculate interference.

The launcher preserves exact script/input snapshots, hashes, process identity, output and a result receipt in a new directory. A deadline ends only the owned helper; the native call may still be running, so timeout remains unknown. It does not retry or kill SOLIDWORKS. The private parent directory must exist, and the new run directory must not contain brackets or backticks. The probe's external helper files are observed by hash, not frozen. See [automation guidance](../.agents/skills/solidworks/references/automation.md) for complete invocation, outcomes and subprocess limits.

## What review receives

Keep original files unchanged. The result includes the required editable parts, assemblies and drawings, any specified exports or portable package, a readable preview, and a short source-to-result checklist. The private record preserves source locations, exact script attempts, app identity, file hashes, actual checks, warnings and recovery attempts.

Verification includes the actual saved files reopened in SOLIDWORKS. File existence, an API success code, a screenshot or a disappearing progress window cannot establish correct geometry. Rebuild warnings remain visible even if feature checks pass. A portable package is checked from a separate extraction with its references resolved inside that package.

Interference detection is an explicit operation. The guidance prevents duplicate calculations disguised as metadata or progress polling, distinguishes null results from an observed zero count, and requires bounded recovery without routinely killing the application. Cancellation, a native fault and a later successful check remain separate events.

Technical review does not supply the user's submission decision. Approval identifies the exact artifacts and destination; delivery and external acceptance need their own observed evidence.

## Repeatable evaluation

The [fictional native CAD fixture](../examples/solidworks-skill-fixture/brief.md) provides independently calculable geometry, editable dimensions, a drawing, portable references and separated/overlapping assembly configurations. Give a fresh worker the skill and brief without earlier outputs or generating scripts. Freeze the candidate and its hashes, then have a reviewer derive checks from the brief before inspecting it. Shared-host isolation is instruction-based, not a security sandbox.

The connection helper has been exercised against SOLIDWORKS 2025 API 33.5.0, with empty and nonempty document lists and a dirty owned document. The revised bridge passed live empty and nonempty probes; the empty probe ran through the published launcher and preserved its successful return and dependency receipts. Actual invalid-install and unsupported-runtime cases returned errors; absent/multiple-session guards were tested with simulated process discovery while the real application remained running. These checks establish the tested connection behavior, not compatibility with every SOLIDWORKS release or successful arbitrary modeling.

The [connection regressions](../tests/solidworks-helper/README.md) passed 39 offline checks against fictional managed interfaces, including stale bridge detection, document transitions and original error chains. The [launcher regressions](../tests/solidworks-helper/LAUNCHER_TESTS.md) passed 34 offline checks using fictional jobs, including complete output streams, timeout uncertainty, unrelated-process survival, exact JSON boundaries and no overwrite. These suites do not operate CAD or prove cancellation of a blocked native call.

The fictional fixture is a reproducible evaluation specification, not a claim that its native construction trial has passed. Keep real work, source documents, CAD outputs, credentials and execution traces outside the public repository. A limited trial cannot establish universal completeness, manufacturing fitness or autonomous completion of every CAD job.
