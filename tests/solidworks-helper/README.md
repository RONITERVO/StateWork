# Offline SOLIDWORKS helper regression checks

Run from 64-bit Windows PowerShell 5.1 in STA:

```powershell
powershell.exe -NoProfile -STA -File .\tests\solidworks-helper\run-offline.ps1
```

Use `-SkillRoot <directory-containing-SKILL.md>` when the skill lives elsewhere. Optional `-OutputPath <private-results.json>` preserves the report; otherwise JSON goes to stdout. Exit 0 means the offline regressions passed. A failing assertion exits nonzero.

The harness compiles the exact C# bridge text produced by the public helper against fictional managed interfaces. It checks stable/unnamed/empty documents, active/list transitions, changed paths and unsaved state, malformed/null entries, stale compiled bridges, original HRESULT chains, attach-attempt diagnostics, and the real probe's absent-session JSON/exit behavior. The absent-session case replaces process discovery with an empty managed stub and rejects unexpected compilation.

It never loads installed SOLIDWORKS interop, invokes the native `Attach` method, queries a real process/session, launches CAD, opens models, or runs interference detection. These tests establish helper control-flow contracts; they do not validate actual COM marshaling, native document enumeration, licensing, model behavior, or a blocked native call's cancellation. Those require separately authorized live checks by the session owner.
