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

Before connecting, the job copies the kit and the body into its run directory
(SwKit.cs, body.cs) and compiles those copies, so the run's evidence holds the exact
source that ran even if the originals are edited for a retry. dependencies.json
records SHA-256 of the originals and the copies. Numbers in args arrive as Int32/Int64
(integers) or Double (decimals; Windows PowerShell's Decimal is converted); read them
with SwKit.Cad.ArgDouble/ArgInt/ArgBool/ArgString. A compile error is reported with
file(line,column). Stdout is one JSON object:
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

function ConvertTo-JobValue($Value) {
    if ($null -eq $Value) { return $null }
    if ($Value -is [decimal]) { return [double]$Value }
    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $map = New-Object 'System.Collections.Generic.Dictionary[string,object]'
        foreach ($p in $Value.PSObject.Properties) { $map[$p.Name] = ConvertTo-JobValue $p.Value }
        return $map
    }
    if ($Value -is [Array]) {
        $list = New-Object 'System.Collections.Generic.List[object]'
        foreach ($item in $Value) { $list.Add((ConvertTo-JobValue $item)) }
        return ,($list.ToArray())
    }
    return $Value
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

    # Freeze the exact sources that will be compiled next to the run's other evidence.
    $kitCopy = Join-Path $PSScriptRoot 'SwKit.cs'
    $bodyCopy = Join-Path $PSScriptRoot 'body.cs'
    Copy-Item -LiteralPath $kitPath -Destination $kitCopy -ErrorAction Stop
    Copy-Item -LiteralPath $bodyPath -Destination $bodyCopy -ErrorAction Stop
    $receipt = Get-Receipt -Paths @($kitPath, $bodyPath, $connectPath, $kitCopy, $bodyCopy)
    $output.Dependencies = $receipt
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($receipt | ConvertTo-Json -Depth 6))
    $stream = [IO.File]::Open((Join-Path $PSScriptRoot 'dependencies.json'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush() } finally { $stream.Dispose() }

    . $connectPath
    $connection = Connect-SolidWorks

    # Separate source files keep each file's using directives and real line numbers in errors.
    try {
        Add-Type -ReferencedAssemblies @($connection.InteropPath, $connection.ConstantsPath, 'System.Core') -Path @($kitCopy, $bodyCopy) -ErrorAction Stop | Out-Null
    } catch {
        $compileErrors = @()
        $ex = $_.Exception
        if ($ex.PSObject.Properties.Name -contains 'Errors' -and $ex.Errors) {
            foreach ($e in $ex.Errors) { $compileErrors += ('{0}({1},{2}): {3} {4}' -f [IO.Path]::GetFileName($e.FileName), $e.Line, $e.Column, $e.ErrorNumber, $e.ErrorText) }
        }
        if ($compileErrors.Count -gt 0) { throw ('Compile failed (body.cs is the frozen copy of ' + $bodyPath + '): ' + ($compileErrors -join ' | ')) }
        throw
    }

    $jobArgs = New-Object 'System.Collections.Generic.Dictionary[string,object]'
    if ($names -contains 'args' -and $null -ne $inputData.args) {
        foreach ($property in $inputData.args.PSObject.Properties) { $jobArgs[$property.Name] = ConvertTo-JobValue $property.Value }
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
