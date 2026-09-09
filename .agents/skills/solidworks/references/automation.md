# Session and native automation

Use the installed desktop SOLIDWORKS application and that installation's API documentation. This workflow is for Windows desktop SOLIDWORKS; a browser-only CAD session, an installation record or another agent's connection does not prove usable desktop access.

## Connection

The scripts in this skill provide a read-only session probe and reusable connection function. They require 64-bit Windows PowerShell 5.1 in STA, under the same Windows user/session and integrity level as SOLIDWORKS. The bundled helper deliberately rejects PowerShell 7; that is a helper constraint, not a claim that every other automation bridge is unavailable.

Use the bounded invocation below even for metadata: a busy native application can block a synchronous COM call. The underlying `scripts/probe-solidworks.ps1` prints JSON session metadata or a JSON error with a nonzero exit code. Its optional `-InstallRoot` asserts the already running installation; it cannot select between multiple processes. For a private job script, dot-source `scripts/connect-solidworks.ps1`, call `Connect-SolidWorks`, then `Get-SolidWorksSessionInfo -Connection $connection`. The connection's `Application` is a COM runtime callable wrapper. At a compiled C# job boundary, accept `object` and cast to `ISldWorks` inside C#; PowerShell's binder may fail when directly binding the wrapper to a typed interface parameter.

The helpers attach to an existing session; they do not establish a license, launch an application or approve dialogs. Inspect the reported installation, version and documents before taking ownership. If multiple installations or sessions make the target ambiguous, resolve the intended one before writing CAD data. Metadata compares two observations of document identities, paths, active membership and dirty state. Matching observations are not an atomic snapshot or an ownership lock. The helper fingerprints its compiled bridge and rejects stale loaded code; use a fresh PowerShell process after updating it. Structured errors retain original HRESULT chains and attachment attempts.

Use the installation's `SolidWorks.Interop.sldworks.dll` and `SolidWorks.Interop.swconst.dll` when typed interfaces are needed. A .NET runtime may lack `Marshal.GetActiveObject`; a supported running-object lookup and installed typed interop can still work. Do not interpret one bridge failure as proof SOLIDWORKS is unavailable. Avoid downloading arbitrary interop binaries or reusing an unrelated installation's assemblies.

Consult installed API help for the exact method, overload, enum and release. Many SOLIDWORKS APIs expose system values in meters and radians even when the document displays millimeters/degrees. Establish conversions at the boundary and verify a known dimension in the saved model. Do not infer a return type, success code, selection mark or relation name from a similar method.

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

## Ownership and execution

Record application process identity, API version, open documents and any pre-existing dirty documents. Keep one agent or job as the session owner; do not interleave scripts and UI input from different workers. Pass exact document paths or verified document objects. A window title or active-document pointer alone can change after a modal, file open or another user's action.

Use small, inspectable operations with private scripts and structured parameters. Persist the exact script and input used before running it, with a distinct attempt ID. Record `started`, `returned` or `failed/unknown` around calls that can block, including open, rebuild, interference, export and packaging. Flush those records so a crash does not erase the last attempted call. Keep the original error/HRESULT and returned warning bitmask.

Run longer automation in a separately identifiable helper process so the controller can inspect status and remain responsive. Set a job-specific deadline proportional to the operation and candidate size. Ending a timed-out helper does not cancel or roll back a call already executing in SOLIDWORKS; inspect the application before doing anything else. Never kill SOLIDWORKS as routine recovery or start another copy while the existing one may still be working.

Discover UI operations through the available computer-use skill. Observe the actual window/modal before acting, and refresh after input. Do not automate an authentication or security dialog through an alternate bridge. Keep application preference changes minimal; record original values and restore them in a cleanup path. Temporary dimension-entry settings are not a reason to alter global security, units or user defaults silently.
