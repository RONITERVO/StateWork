<#
.SYNOPSIS
Self-contained job for invoke-solidworks-job.ps1; observes an existing session.
.DESCRIPTION
InputJsonPath must name JSON with skillRoot set to the absolute installed
SOLIDWORKS skill directory. The copied job writes dependency receipts in its
new run directory before and after calling scripts/probe-solidworks.ps1.
Receipts hash those external probe/connect scripts; they do not freeze them,
lock them, or attest transitive dependencies such as installed interop DLLs.
The existing probe supplies its own session/runtime checks and JSON result.
#>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string] $InputJsonPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Get-DependencyReceipt([string[]] $Paths) {
    $files = @()
    foreach ($path in $Paths) {
        $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
        if ($item.PSIsContainer -or $item.PSProvider.Name -ne 'FileSystem') { throw "Expected helper file: $path" }
        $files += [pscustomobject]@{Path=$item.FullName; Sha256=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); Length=$item.Length; LastWriteTimeUtc=$item.LastWriteTimeUtc.ToString('o')}
    }
    return [pscustomobject]@{
        SchemaVersion=1; ObservedAtUtc=[DateTime]::UtcNow.ToString('o'); Files=$files
        Scope='External probe/connect script hashes observed at this time; files are not frozen or locked. Transitive dependencies, including installed interop assemblies, are not attested.'
    }
}
function Write-NewReceipt([string] $Name, $Receipt) {
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($Receipt | ConvertTo-Json -Depth 8))
    $stream = [IO.File]::Open((Join-Path $PSScriptRoot $Name), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush() } finally { $stream.Dispose() }
}

$inputData = [IO.File]::ReadAllText($InputJsonPath) | ConvertFrom-Json
if ($null -eq $inputData -or -not ($inputData.PSObject.Properties.Name -contains 'skillRoot') -or
    -not ($inputData.skillRoot -is [string]) -or [string]::IsNullOrWhiteSpace($inputData.skillRoot)) {
    throw 'Input JSON must contain a nonempty string skillRoot.'
}
$skillPath = $inputData.skillRoot
if (-not [IO.Path]::IsPathRooted($skillPath) -or $skillPath -match '^[A-Za-z]:(?:$|[^\\/])' -or $skillPath -match '^[\\/][^\\/]') {
    throw 'skillRoot must be an absolute filesystem path, not drive-relative or root-relative.'
}
$skillItem = Get-Item -LiteralPath $skillPath -Force -ErrorAction Stop
if (-not $skillItem.PSIsContainer -or $skillItem.PSProvider.Name -ne 'FileSystem') { throw 'skillRoot must be an existing filesystem directory.' }
$probePath = Join-Path $skillItem.FullName 'scripts/probe-solidworks.ps1'
$connectPath = Join-Path $skillItem.FullName 'scripts/connect-solidworks.ps1'
$dependencies = @($probePath, $connectPath)
$before = Get-DependencyReceipt -Paths $dependencies
Write-NewReceipt -Name 'probe-dependencies-before.json' -Receipt $before
$probeExitCode = 1
try {
    $global:LASTEXITCODE = 0
    & $probePath
    $probeSucceeded = $?
    $probeExitCode = [int] $global:LASTEXITCODE
    if (-not $probeSucceeded -and $probeExitCode -eq 0) { $probeExitCode = 1 }
} finally {
    $after = Get-DependencyReceipt -Paths $dependencies
    Write-NewReceipt -Name 'probe-dependencies-after.json' -Receipt $after
    for ($index = 0; $index -lt $before.Files.Count; $index++) {
        if ($before.Files[$index].Path -cne $after.Files[$index].Path -or $before.Files[$index].Sha256 -cne $after.Files[$index].Sha256) {
            throw 'Probe dependencies changed between observations; the invocation cannot be attributed to one stable dependency snapshot.'
        }
    }
}
exit $probeExitCode
