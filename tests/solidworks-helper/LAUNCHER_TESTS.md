# Offline bounded-launcher regressions

Run from this repository with 64-bit Windows PowerShell 5.1:

```powershell
powershell.exe -NoProfile -STA -File .\tests\solidworks-helper\run-launcher-offline.ps1
```

The suite creates a unique directory in `TEMP` and preserves all fictional jobs,
input snapshots, logs, dependency receipts, and `test-results.json`. An optional
`-OutputDirectory` chooses a new directory; its parent must already exist.
`-SkillRoot` can select another installed copy of the skill.

The tests launch only fictional PowerShell jobs and a temporary fake
probe/connect pair. They never invoke the real probe, load installed interop,
discover SOLIDWORKS processes, attach COM, or operate CAD. The existing
`run-offline.ps1` tests the separate connection/metadata helper contract.

Coverage includes:

- Exact source and JSON byte hashes; spaces, apostrophes, and literal bracket
  characters in source paths; JSON quotes, newlines, and shell-like text.
- Copied-job `PSScriptRoot`, working directory, 64-bit Windows PowerShell 5.1 STA,
  stdout/stderr separation, and complete draining of two 12,000-line streams.
- Normal return, nonzero exit, thrown error, missing return receipt, default
  30-second deadline, and an expiring two-second deadline with owned-helper cleanup.
- An unrelated helper with the same executable survives timeout cleanup.
- Existing run directories remain untouched; malformed input, missing jobs, and
  run paths incompatible with Windows PowerShell redirection fail before launch.
- The self-contained probe job records external helper hashes before and after
  invocation, propagates failure, rejects observed changes and drive-relative
  dependency paths, and states that those dependencies are not frozen.

The tests establish launcher/process behavior, not CAD correctness, COM call
cancellation, a live-session ownership lock, or a hard real-time OS deadline.
Terminating a helper cannot establish cancellation of an in-flight SOLIDWORKS
call. Private run directories inherit their parent's ACLs.
Jobs must await their own subprocesses when synchronous completion is required:
unawaited descendants can outlive a returned helper and hold inherited outer
host pipe handles. The launcher does not kill process trees or bound an outer
host's output collection.
