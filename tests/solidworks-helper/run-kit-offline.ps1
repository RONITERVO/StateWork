<#
.SYNOPSIS
Offline regressions for the SwKit tooling: compile gate, one-call wrapper compile stage, API lookup, dialog lister.
.DESCRIPTION
Needs an installed SOLIDWORKS (its interop assemblies) but no running session and no documents:
  powershell.exe -NoProfile -STA -File tests/solidworks-helper/run-kit-offline.ps1
Never attaches to SOLIDWORKS. The live smoke tests (scripts/examples/smoke-tray.cs, smoke-features.cs) cover the
CAD behaviour; this suite covers what can break without CAD: C# 5 compatibility of the kit and examples, error
reporting with file and line, the wrapper stopping before any live call on a compile error, and API lookup output.
#>
[CmdletBinding()]
param([string] $SkillRoot)
$ErrorActionPreference = 'Stop'
if (-not $SkillRoot) { $SkillRoot = Join-Path $PSScriptRoot '..\..\.agents\skills\solidworks' }
$SkillRoot = (Get-Item -LiteralPath $SkillRoot).FullName
$ps = Join-Path $PSHOME 'powershell.exe'
$checks = New-Object System.Collections.Generic.List[object]
function Assert-Check([string] $Name, [bool] $Condition, [string] $Detail = '') {
    $checks.Add([pscustomobject]@{ Name = $Name; Passed = $Condition; Detail = $Detail })
    if (-not $Condition) { throw ('Regression failed: {0} {1}' -f $Name, $Detail) }
}
function Invoke-Json([string[]] $Arguments) {
    $out = & $ps @Arguments
    $code = $LASTEXITCODE
    $text = ($out -join "`n")
    $json = $null
    if ($text.Contains('{')) { $json = $text.Substring($text.IndexOf('{')) | ConvertFrom-Json }
    return [pscustomobject]@{ Code = $code; Json = $json; Text = $text }
}

$temp = Join-Path ([IO.Path]::GetTempPath()) ('swkit-offline-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    $compile = Join-Path $SkillRoot 'scripts\compile-check.ps1'
    foreach ($example in @('smoke-tray.cs', 'smoke-features.cs')) {
        $r = Invoke-Json @('-NoProfile', '-STA', '-File', $compile, '-BodyPath', (Join-Path $SkillRoot "scripts\examples\$example"))
        Assert-Check "kit + $example compile with C# 5" ($r.Code -eq 0 -and $r.Json.Ok) ($r.Json.Errors -join ' | ')
    }

    $bad = Join-Path $temp 'csharp6-body.cs'
    [IO.File]::WriteAllText($bad, @'
using System.Collections.Generic;
using SwKit;
namespace SwKitJob
{
    public static class Job
    {
        public static object Run(Cad cad, IDictionary<string, object> args)
        {
            string name = "x";
            return $"interpolated {name}";
        }
    }
}
'@)
    $r = Invoke-Json @('-NoProfile', '-STA', '-File', $compile, '-BodyPath', $bad)
    Assert-Check 'C# 6 body is rejected offline' ($r.Code -eq 1 -and -not $r.Json.Ok)
    Assert-Check 'compile error names the body file and line' ((@($r.Json.Errors) -join ' ') -match 'csharp6-body\.cs\(10')

    $wrapper = Join-Path $SkillRoot 'scripts\sw-job.ps1'
    $r = Invoke-Json @('-NoProfile', '-STA', '-File', $wrapper, '-BodyPath', $bad, '-RunRoot', (Join-Path $temp 'runs'))
    Assert-Check 'wrapper stops at the compile stage with exit 3' ($r.Code -eq 3 -and $r.Json.Stage -eq 'compile' -and -not $r.Json.Ok)
    Assert-Check 'wrapper made no run directory for a compile error' (-not (Test-Path (Join-Path $temp 'runs')) -or @(Get-ChildItem (Join-Path $temp 'runs') -Directory).Count -eq 0)

    $lookup = Join-Path $SkillRoot 'scripts\api-lookup.ps1'
    $sig = (& $ps -NoProfile -File $lookup -Type IFeatureManager -Member EditRollback) -join "`n"
    Assert-Check 'api-lookup prints a method signature with parameter names' ($sig -match 'bool EditRollback\(int Location, string Feature\)') $sig
    $enum = (& $ps -NoProfile -File $lookup -Enum swMoveRollbackBarTo_e) -join "`n"
    Assert-Check 'api-lookup prints enum values' ($enum -match 'swMoveRollbackBarToBeforeFeature = 3') $enum
    $prop = (& $ps -NoProfile -File $lookup -Type IConfiguration -Member SuppressNewFeatures) -join "`n"
    Assert-Check 'api-lookup prints settable properties' ($prop -match 'property bool SuppressNewFeatures \{ get; set \}') $prop

    $dialogs = Invoke-Json @('-NoProfile', '-File', (Join-Path $SkillRoot 'scripts\list-dialogs.ps1'))
    Assert-Check 'list-dialogs returns JSON with Ok' ($null -ne $dialogs.Json -and ($dialogs.Json.PSObject.Properties.Name -contains 'Ok'))
} finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
[pscustomobject]@{ Scope = 'Installed interop only; no SOLIDWORKS session calls'; Passed = $true; CheckCount = $checks.Count; Checks = $checks } | ConvertTo-Json -Depth 4

