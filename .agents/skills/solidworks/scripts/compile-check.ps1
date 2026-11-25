<#
.SYNOPSIS
Offline compile check of scripts/lib/SwKit.cs plus an optional C# job body.
.DESCRIPTION
Run with 64-bit Windows PowerShell 5.1 in a fresh process:
  powershell.exe -NoProfile -STA -File <skill>/scripts/compile-check.ps1 -BodyPath <job.cs>
Compiles against the installation's SolidWorks.Interop assemblies with the same
C# 5 compiler that run-csharp-job.ps1 uses. It does not attach to SOLIDWORKS,
open documents or change settings, so typing errors surface before a live job
can leave half-built documents open. Prints JSON {Ok, Errors, InstallRoot};
exit code 0 when the source compiles, 1 otherwise. Compiler warnings are errors.
#>
[CmdletBinding()]
param(
    [string] $BodyPath,
    # Installation directory containing SLDWORKS.exe. Default: the running
    # process, else the registered install location, else the standard path.
    [string] $InstallRoot
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Resolve-InstallRoot {
    if ($InstallRoot) { return (Get-Item -LiteralPath $InstallRoot).FullName }
    $running = @(Get-Process -Name SLDWORKS -ErrorAction SilentlyContinue)
    if ($running.Count -ge 1) {
        try { if ($running[0].Path) { return [IO.Path]::GetDirectoryName($running[0].Path) } } catch { }
    }
    foreach ($key in @('HKLM:\SOFTWARE\SolidWorks\SOLIDWORKS 2026\Setup', 'HKLM:\SOFTWARE\SolidWorks\SOLIDWORKS 2025\Setup',
                       'HKLM:\SOFTWARE\SolidWorks\SOLIDWORKS 2024\Setup')) {
        $item = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
        if ($item -and ($item.PSObject.Properties.Name -contains 'SolidWorks Folder')) { return $item.'SolidWorks Folder'.TrimEnd('\') }
    }
    return 'C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS'
}

$result = [ordered]@{ Ok = $false; Errors = @(); InstallRoot = $null; Sources = @() }
try {
    if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess) {
        throw 'Use 64-bit Windows PowerShell 5.1 (the same compiler as the job runner).'
    }
    $root = Resolve-InstallRoot
    $result.InstallRoot = $root
    $interop = Join-Path $root 'api\redist\SolidWorks.Interop.sldworks.dll'
    $constants = Join-Path $root 'api\redist\SolidWorks.Interop.swconst.dll'
    foreach ($required in @($interop, $constants)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Interop assembly not found: $required" }
    }
    $kit = Join-Path (Split-Path -Parent $PSCommandPath) 'lib\SwKit.cs'
    $sources = @($kit)
    if ($BodyPath) { $sources += (Get-Item -LiteralPath $BodyPath).FullName }
    $result.Sources = $sources
    Add-Type -Path $interop
    Add-Type -Path $constants
    try {
        # Separate source files keep each file's using directives and real line numbers in errors.
        $uiAutomation = @('UIAutomationClient', 'UIAutomationTypes', 'WindowsBase') | ForEach-Object { [Reflection.Assembly]::Load($_ + ', Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35').Location }
        Add-Type -ReferencedAssemblies (@($interop, $constants, 'System.Core') + $uiAutomation) -Path $sources -ErrorAction Stop | Out-Null
        $result.Ok = $true
    } catch {
        $messages = @()
        $exception = $_.Exception
        if ($exception.PSObject.Properties.Name -contains 'Errors' -and $exception.Errors) {
            foreach ($e in $exception.Errors) { $messages += ('{0}({1},{2}): {3} {4}' -f [IO.Path]::GetFileName($e.FileName), $e.Line, $e.Column, $e.ErrorNumber, $e.ErrorText) }
        }
        if ($messages.Count -eq 0) { $messages += $exception.Message }
        $result.Errors = $messages
    }
} catch {
    $result.Errors = @($_.Exception.Message)
}
[pscustomobject]$result | ConvertTo-Json -Depth 6
if ($result.Ok) { exit 0 } else { exit 1 }
