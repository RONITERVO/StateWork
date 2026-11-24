# Session and native automation

In short: probe the session, write a C# job body against SwKit, compile-check it offline, run it through the bounded launcher, then verify the saved result. The sections below explain each step and its limits.

Use the installed desktop SOLIDWORKS application and that installation's API documentation. This workflow is for Windows desktop SOLIDWORKS; a browser-only CAD session, an installation record or another agent's connection does not prove usable desktop access.

## Connection

The scripts in this skill provide a read-only session probe and reusable connection function. They require 64-bit Windows PowerShell 5.1 in STA, under the same Windows user, interactive desktop, session and integrity level as SOLIDWORKS. The bundled helper deliberately rejects PowerShell 7; that is a helper constraint, not a claim that every other automation bridge is unavailable.

An execution harness running inside an isolated or non-interactive Windows desktop (where `EnumWindows` and `IRunningObjectTable` return empty and `GetActiveObject` fails with `0x800401E3 MK_E_UNAVAILABLE` even while `SLDWORKS.exe` is healthy under the same user and integrity level) cannot attach to desktop SOLIDWORKS or drive its UI. Diagnose the shell's window station and desktop early instead of retrying COM attach or misdiagnosing SOLIDWORKS as stuck, and delegate desktop automation to a worker on the interactive desktop without attempting to bypass isolation.

Use the bounded invocation below even for metadata: a busy native application can block a synchronous COM call. The underlying `scripts/probe-solidworks.ps1` prints JSON session metadata or a JSON error with a nonzero exit code. Its optional `-InstallRoot` asserts the already running installation; it cannot select between multiple processes. For a private job script, dot-source `scripts/connect-solidworks.ps1`, call `Connect-SolidWorks`, then `Get-SolidWorksSessionInfo -Connection $connection`. The connection's `Application` is a COM runtime callable wrapper. At a compiled C# job boundary, accept `object` and cast to `ISldWorks` inside C#; PowerShell's binder may fail when directly binding the wrapper to a typed interface parameter.

The helpers attach to an existing session; they do not establish a license, launch an application or approve dialogs. Inspect the reported installation, version and documents before taking ownership. If multiple installations or sessions make the target ambiguous, resolve the intended one before writing CAD data. Metadata compares two observations of document identities, paths, active membership and dirty state. Matching observations are not an atomic snapshot or an ownership lock. The helper fingerprints its compiled bridge and rejects stale loaded code; use a fresh PowerShell process after updating it. Structured errors retain original HRESULT chains and attachment attempts.

Use the installation's `SolidWorks.Interop.sldworks.dll` and `SolidWorks.Interop.swconst.dll` when typed interfaces are needed. A .NET runtime may lack `Marshal.GetActiveObject`; a supported running-object lookup and installed typed interop can still work. Do not interpret one bridge failure as proof SOLIDWORKS is unavailable. Avoid downloading arbitrary interop binaries or reusing an unrelated installation's assemblies.

Compile-check embedded C# interop source offline (`Add-Type` referencing the installed `SolidWorks.Interop.*.dll` assemblies without attaching to SOLIDWORKS) before launching a live CAD job. Subtle RCW typing rules—such as `IComponent2.Transform2` requiring the concrete `MathTransform` coclass rather than `IMathTransform`—fail immediately offline without leaving partially modified documents open.

Consult installed API help for the exact method, overload, enum and release. Many SOLIDWORKS APIs expose system values in meters and radians even when the document displays millimeters/degrees. Establish conversions at the boundary and verify a known dimension in the saved model. Do not infer a return type, success code, selection mark or relation name from a similar method.

Normalize native file and template arguments to absolute Windows paths before invoking the API. If a valid template yields a null `NewDocument` result, inspect path syntax as well as template identity and application state before recreating the template.

Read operational notes as well as the generated signature. Some typed setters exist but are explicitly unimplemented: for example, the loft's `StartConstraintApplyToAll` and `EndConstraintApplyToAll` are documented as get-only. A successful compilation does not establish that a setter works. Trace consequential setters separately so a failure can be attributed before changing the model again.

When a .NET API requires an array of `IDispatch` objects, follow its [marshaling contract](https://help.solidworks.com/2012/english/api/sldworksapiprogguide/Overview/IDispatch_Object_Arrays_as_Input_in_.NET.htm) and runtime support; use `DispatchWrapper[]` where documented. Do not apply this conversion to numeric or string arrays. Read back the retained entity count and identities before the next operation; a plain `object[]` setter can return without retaining the intended native objects.

Inspect numeric return arrays before casting: `GetUnits` can return `Int16[]`, so a direct `int[]` cast can fail after successful modeling. Preserve the actual type and values, then enumerate the `Array` and convert documented numeric elements deliberately. Null remains unavailable. If only the reader failed, preserve the completed geometry and correct that reader before repeating construction.

## Bounded jobs

For a session probe, write a private JSON file containing the absolute installed skill directory:

```json
{ "skillRoot": "C:/path/to/skills/solidworks" }
```

Then run from 64-bit Windows PowerShell 5.1, replacing the paths with actual locations:

```powershell
powershell.exe -NoProfile -STA -File "C:/path/to/skills/solidworks/scripts/invoke-solidworks-job.ps1" `
  -JobPath "C:/path/to/skills/solidworks/scripts/jobs/probe-session.ps1" `
  -InputJsonPath "D:/private-work/probe-input.json" `
  -RunDirectory "D:/private-work/probe-attempt-001" `
  -TimeoutSeconds 30
```

The input file and run directory's parent must exist; the run directory must be new. The launcher snapshots the exact job and optional JSON bytes, records hashes before launch, and starts a hidden 64-bit Windows PowerShell 5.1 STA helper. It preserves launch and process identity, return receipt, separate output streams and final `result.json`. Existing run directories are never reused. The run directory must not contain brackets or backticks because Windows PowerShell redirection mishandles those paths. Spaces and apostrophes are supported; source job/input paths can contain literal brackets.

For other jobs, supply an existing self-contained `.ps1`, accepting `param([string]$InputJsonPath)` when input is needed. The copied job runs with its working directory and `PSScriptRoot` inside the new run directory. Sibling files are not copied; pass explicit dependencies. The supplied probe job observes external probe/connect hashes before and after execution, but does not freeze or lock those files or attest their transitive dependencies. The input is structured data, not shell text. These are trusted jobs, not a sandbox; run directories inherit their parent's access permissions.

Choose `TimeoutSeconds` for the operation (1–3600, default 30). Exit 0 / `returned` means the helper reported successful return and its output was drained; inspect its actual CAD result separately. Exit 1 / `failed` reports setup or job failure. Exit 2 / `unknown` means completion could not be established, including a deadline or missing return receipt. Timeout cleanup acts only on the retained helper process and waits at most five seconds. It never kills SOLIDWORKS, kills a process tree or retries. A native call may continue after the helper ends.

The monotonic deadline bounds waiting for the owned helper and its redirected streams, not a hard real-time OS guarantee. Jobs must await their own subprocesses when their completion matters. Unawaited descendants can survive a returned helper and retain outer host output pipes; the launcher cannot bound that host's collection. After timeout inspect the live application before starting further work.

## C# jobs with SwKit

Use typed C# for anything that changes CAD data. Ref/out parameters, enums and interface casts behave as documented there, and the compiler catches typing mistakes before SOLIDWORKS is touched. The skill ships four pieces:

- `scripts/lib/SwKit.cs` holds the `SwKit.Cad` helper class: documents, geometry lookup by type and position, exact sketch creation, dimensions and relations, features, equations, configurations, assemblies, interference and exports. It takes millimetres, checks every native return and throws `CadException` naming the step. Its header lists the conventions.
- `scripts/jobs/run-csharp-job.ps1` is the job for the bounded launcher. It records SHA-256 hashes of the kit, body and connect helper in `dependencies.json`, connects, compiles the kit with your body, calls `SwKitJob.Job.Run(cad, args)`, and prints `{Ok, Result, Error, Log, Dependencies}`.
- `scripts/compile-check.ps1` compiles the kit and a body against the installed interop without attaching to SOLIDWORKS.
- `scripts/examples/smoke-tray.cs` is the end-to-end example and smoke test. It builds and checks a part with a shell, cuts, patterns, a fill pattern and two configurations, then a mated assembly with an interference count.

Workflow:

1. Write the body from the skeleton in [cookbook.md](cookbook.md) in a private work folder, one stage per job. Read arguments with `Cad.ArgString/ArgDouble/ArgInt/ArgBool`: JSON integers arrive as Int32/Int64, decimals as Double (the runner converts Windows PowerShell's Decimal), booleans as Boolean, arrays as object[] and objects as dictionaries. A direct `(double)args["x"]` compiles and then throws for an integer.
2. Run it with `scripts/sw-job.ps1 -BodyPath <body.cs> -ArgsPath <args.json> -TimeoutSeconds <n>`. The wrapper:
   - compiles the kit with the body offline and stops with exit 3 on a C# error;
   - writes the input JSON `{skillRoot, bodyPath, args}` next to a new run directory under `-RunRoot` (default: `runs` beside the body, created if missing);
   - runs `invoke-solidworks-job.ps1` with `jobs/run-csharp-job.ps1` and prints `{Stage, Outcome, Ok, Error, Result, Log, RunDirectory, TimedOut}`.

   Exit codes: 0 Ok, 1 the job threw, 2 timeout or unknown, 3 compile error, 4 wrapper failure. Size `-TimeoutSeconds` to the work: tens of seconds for a simple part, minutes for fill patterns, large assemblies, interference or per-feature definition edits on a big part (each `ModifyDefinition` rebuilds).

3. The run directory keeps frozen copies of the kit and body (`SwKit.cs`, `body.cs`), and those copies are what was compiled. It also holds their hashes and the originals' (`dependencies.json`), stdout/stderr and the launcher receipt. You may edit the body for a retry without losing the evidence of the earlier attempt.
4. If `Ok` is false, `Error.Message` names the failing step and `Log` lists the completed steps. Documents stay open as they were. Inspect them and continue from that state with a new job; do not rerun the whole body.

The manual path still works: `compile-check.ps1 -BodyPath`, then `invoke-solidworks-job.ps1 -JobPath <skill>/scripts/jobs/run-csharp-job.ps1 -InputJsonPath <json> -RunDirectory <new dir>`. Create the run directory's parent first; the launcher creates only the run directory itself.

Look up any call the kit does not wrap with `scripts/api-lookup.ps1` (signatures, properties and enum values from the installed interop; no session needed). When a job stops returning, run `scripts/list-dialogs.ps1`. It lists SOLIDWORKS' visible windows and their control texts through Win32 only, without attaching, so it is safe while a call is blocked. It shows whether a modal (Modify box, rebuild error, save prompt) is holding the call.

The compiler is C# 5, from .NET Framework, as used by Windows PowerShell 5.1 `Add-Type`. String interpolation, `?.`, `nameof`, `out var`, tuples and expression-bodied members are unavailable. Compiled types cannot be reloaded in a process, so each run and each compile check needs a fresh process; the launcher already provides one.

Run both smoke tests (`smoke-tray.cs`, then `smoke-features.cs` with args `{"outDir", "wallMm": 2.5, "count": 2, "flag": true}`) once per machine or SOLIDWORKS version, with an `outDir` in a private scratch folder. `Result.passed` must be true for both. `tests/solidworks-helper/run-kit-offline.ps1` checks the compile gate, the wrapper's compile stage, `api-lookup` and `list-dialogs` without a session. The test creates and saves `SwKitSmoke_*` files there and closes the documents it created. A failure there is a kit or installation problem to fix before modeling real work.

The kit and `smoke-tray.cs` were verified end to end on SOLIDWORKS 2025 (33.5) Student Edition. In both configurations the volumes matched the specification-derived values exactly; the STL volume was within 0.005 %; the upper tray mated fully defined at Z = 20 with no interference; and every changed user preference read back at its original value afterwards. It was re-run after the editing helpers were added (rollback/insert, reorder, equation delete, `EdgeAt`, configuration checks, interference pairs) and passed again. Rerun the test after changing the kit.

If a job stops returning, check for a modal SOLIDWORKS window, such as the Modify dimension box, before waiting out the deadline. The API call stays blocked until the window is answered. Stop only the job's own helper `powershell.exe` (the launcher's child, identified by its run-directory command line), then dismiss the window with Escape. The application then usually still has an open command, so press Escape again. Close the never-saved document the job created with a small cleanup job, fix the cause, and run again. Never stop `SLDWORKS.exe`.

## Ownership and execution

Record application process identity, API version, open documents and any pre-existing dirty documents. Keep one agent or job as the session owner; do not interleave scripts and UI input from different workers. Pass exact document paths or verified document objects. A window title or active-document pointer alone can change after a modal, file open or another user's action.

Use small, inspectable operations with private scripts and structured parameters. Persist the exact script and input used before running it, with a distinct attempt ID. Record `started`, `returned` or `failed/unknown` around calls that can block, including open, rebuild, interference, export and packaging. Flush those records so a crash does not erase the last attempted call. Keep the original error/HRESULT and returned warning bitmask.

Run longer automation in a separately identifiable helper process so the controller can inspect status and remain responsive. Set a job-specific deadline proportional to the operation and candidate size. Ending a timed-out helper does not cancel or roll back a call already executing in SOLIDWORKS; inspect the application before doing anything else. Never kill SOLIDWORKS as routine recovery or start another copy while the existing one may still be working.

Discover UI operations through the available computer-use skill. Observe the actual window/modal before acting, and refresh after input. Do not automate an authentication or security dialog through an alternate bridge, and do not click promotional or marketplace task panes (such as 3DEXPERIENCE Marketplace). Inspect loaded add-ins before batch opens or closes: unrelated add-ins such as SOLIDWORKS CAM can trigger blocking save prompts on close even for read-only documents; note them and disable or unload interfering non-task add-ins only when authorized, restoring state afterward. Keep application preference changes minimal; record original values and restore them in a cleanup path. Temporary dimension-entry settings are not a reason to alter global security, units or user defaults silently.
