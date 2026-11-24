<#
.SYNOPSIS
Self-contained job for invoke-solidworks-job.ps1: compiles scripts/lib/SwKit.cs with a
C# job body and runs it against the attached SOLIDWORKS session.
.DESCRIPTION
InputJsonPath names JSON with:
  skillRoot  absolute path of the installed SOLIDWORKS skill directory (required)
  bodyPath   absolute path of the C# job body (required)
  args       flat object of job arguments: strings, numbers, booleans, arrays (optional)

The body defines:
  namespace SwKitJob {
    public static class Job {
      public static object Run(SwKit.Cad cad, System.Collections.Generic.IDictionary<string, object> args) { ... }
    }
  }
and returns a Dictionary<string, object> (or any value ConvertTo-Json can render).

Before connecting, the job writes dependencies.json (SHA-256 of the kit, body and
connect helper) in its run directory. Stdout is one JSON object:
  { Ok, Result, Error, Log, Dependencies }
Exit 0 when Run returned, 1 when compilation or Run threw. Documents a failed body
left open stay open for inspection; the job never closes or saves on failure.
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string] $InputJsonPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Get-Receipt([string[]] $Paths) {
    $files = @()
    foreach ($path in $Paths) {
        $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
        $files += [pscustomobject]@{ Path = $item.FullName; Sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); Length = $item.Length }
    }
    return [pscustomobject]@{ ObservedAtUtc = [DateTime]::UtcNow.ToString('o'); Files = $files }
}

function Assert-AbsoluteFile([string] $Path, [string] $Name) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathRooted($Path) -or $Path -match '^[A-Za-z]:(?:$|[^\\/])' -or $Path -match '^[\\/][^\\/]') {
        throw "$Name must be an absolute path."
    }
}

$output = [ordered]@{ Ok = $false; Result = $null; Error = $null; Log = @(); Dependencies = $null }
$cad = $null
$exitCode = 1
try {
    $inputData = [IO.File]::ReadAllText($InputJsonPath) | ConvertFrom-Json
    $names = @($inputData.PSObject.Properties.Name)
    if (-not ($names -contains 'skillRoot') -or -not ($names -contains 'bodyPath')) { throw 'Input JSON must contain skillRoot and bodyPath.' }
    Assert-AbsoluteFile $inputData.skillRoot 'skillRoot'
    Assert-AbsoluteFile $inputData.bodyPath 'bodyPath'
    $skillRoot = (Get-Item -LiteralPath $inputData.skillRoot -ErrorAction Stop).FullName
    $kitPath = Join-Path $skillRoot 'scripts/lib/SwKit.cs'
    $connectPath = Join-Path $skillRoot 'scripts/connect-solidworks.ps1'
    $bodyPath = (Get-Item -LiteralPath $inputData.bodyPath -ErrorAction Stop).FullName

    $receipt = Get-Receipt -Paths @($kitPath, $bodyPath, $connectPath)
    $output.Dependencies = $receipt
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($receipt | ConvertTo-Json -Depth 6))
    $stream = [IO.File]::Open((Join-Path $PSScriptRoot 'dependencies.json'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush() } finally { $stream.Dispose() }

    . $connectPath
    $connection = Connect-SolidWorks

    # Separate source files keep each file's using directives and real line numbers in errors.
    Add-Type -ReferencedAssemblies @($connection.InteropPath, $connection.ConstantsPath, 'System.Core') -Path @($kitPath, $bodyPath) -ErrorAction Stop | Out-Null

    $jobArgs = New-Object 'System.Collections.Generic.Dictionary[string,object]'
    if ($names -contains 'args' -and $null -ne $inputData.args) {
        foreach ($property in $inputData.args.PSObject.Properties) { $jobArgs[$property.Name] = $property.Value }
    }
    $cad = New-Object SwKit.Cad -ArgumentList $connection.Application
    $output.Result = [SwKitJob.Job]::Run($cad, $jobArgs)
    $output.Ok = $true
    $exitCode = 0
} catch {
    $exception = $_.Exception
    while ($exception.InnerException -and ($exception -is [Management.Automation.MethodInvocationException] -or $exception -is [Reflection.TargetInvocationException])) {
        $exception = $exception.InnerException
    }
    $output.Error = [pscustomobject]@{ Type = $exception.GetType().FullName; Message = $exception.Message; HResultHex = ('0x{0:X8}' -f $exception.HResult) }
} finally {
    if ($null -ne $cad) { $output.Log = @($cad.Log) }
}
[pscustomobject]$output | ConvertTo-Json -Depth 12
exit $exitCode
