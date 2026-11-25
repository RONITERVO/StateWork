<#
.SYNOPSIS
One command per SwKit stage: offline compile check, input file, bounded live run, compact result.
.DESCRIPTION
Run with 64-bit Windows PowerShell 5.1:
  powershell.exe -NoProfile -STA -File <skill>/scripts/sw-job.ps1 -BodyPath D:/work/stage1.cs `
      -ArgsPath D:/work/stage1-args.json -TimeoutSeconds 180

1. Compiles the kit plus the body with scripts/compile-check.ps1 (no SOLIDWORKS contact).
   On a compile error it prints {Stage:"compile", Ok:false, Errors} and exits 3.
2. Writes <RunRoot>/<body>-<stamp>-input.json ({skillRoot, bodyPath, args}).
3. Runs scripts/invoke-solidworks-job.ps1 with scripts/jobs/run-csharp-job.ps1 into a new
   run directory <RunRoot>/<body>-<stamp>, which keeps frozen copies of the kit and body,
   hashes, stdout/stderr and the launcher receipt.
4. Prints {Stage:"run", Outcome, LastSteps, Ok, Error, Result, Log, RunDirectory, Memory}. LastSteps is the tail
   of progress.log, which the kit appends to as each step starts: after a timeout its last
   line names the call that did not return.

Exit codes: 0 the job returned Ok; 1 the job threw (Error says where); 2 timeout or
unknown outcome (the native call may still be running: inspect SOLIDWORKS before any new
call); 3 compile error; 4 wrapper failure. RunRoot defaults to a "runs" folder next to
the body and is created if missing. Args: -ArgsPath (a JSON object file) or -ArgsJson
(inline JSON object; quoting is fragile in shells, prefer a file).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $BodyPath,
    [string] $ArgsPath,
    [string] $ArgsJson,
    [string] $RunRoot,
    [ValidateRange(5, 86400)][int] $TimeoutSeconds = 120,
    [string] $SkillRoot
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Out-Json($Object, [int] $Code) {
    $Object | ConvertTo-Json -Depth 20
    exit $Code
}

try {
    if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess) {
        throw 'Use 64-bit Windows PowerShell 5.1 (powershell.exe, not pwsh).'
    }
    if (-not $SkillRoot) { $SkillRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath) }
    $SkillRoot = (Get-Item -LiteralPath $SkillRoot -ErrorAction Stop).FullName
    $body = (Get-Item -LiteralPath $BodyPath -ErrorAction Stop).FullName
    $ps = Join-Path $PSHOME 'powershell.exe'

    # 1. offline compile gate
    $compileOut = & $ps -NoProfile -STA -File (Join-Path $SkillRoot 'scripts\compile-check.ps1') -BodyPath $body
    $compileText = ($compileOut -join "`n")
    $compile = $compileText.Substring($compileText.IndexOf('{')) | ConvertFrom-Json
    if (-not $compile.Ok) {
        Out-Json ([pscustomobject]@{ Stage = 'compile'; Ok = $false; Errors = $compile.Errors; Body = $body }) 3
    }

    # 2. input file
    $jobArgs = [pscustomobject]@{}
    if ($ArgsPath) { $jobArgs = [IO.File]::ReadAllText((Get-Item -LiteralPath $ArgsPath).FullName) | ConvertFrom-Json }
    elseif ($ArgsJson) { $jobArgs = $ArgsJson | ConvertFrom-Json }
    if ($null -ne $jobArgs -and -not ($jobArgs -is [System.Management.Automation.PSCustomObject])) { throw 'Args must be a JSON object.' }
    if (-not $RunRoot) { $RunRoot = Join-Path (Split-Path -Parent $body) 'runs' }
    if (-not (Test-Path -LiteralPath $RunRoot)) { New-Item -ItemType Directory -Path $RunRoot | Out-Null }
    $RunRoot = (Get-Item -LiteralPath $RunRoot).FullName
    $stamp = [DateTime]::Now.ToString('yyyyMMdd-HHmmss-fff')
    $name = ([IO.Path]::GetFileNameWithoutExtension($body) -replace '[^A-Za-z0-9_\-]', '_') + '-' + $stamp
    $inputPath = Join-Path $RunRoot ($name + '-input.json')
    $runDir = Join-Path $RunRoot $name
    $inputObject = [pscustomobject]@{ skillRoot = $SkillRoot; bodyPath = $body; args = $jobArgs }
    [IO.File]::WriteAllText($inputPath, ($inputObject | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))

    # 3. bounded live run
    $launcherOut = & $ps -NoProfile -STA -File (Join-Path $SkillRoot 'scripts\invoke-solidworks-job.ps1') `
        -JobPath (Join-Path $SkillRoot 'scripts\jobs\run-csharp-job.ps1') -InputJsonPath $inputPath -RunDirectory $runDir -TimeoutSeconds $TimeoutSeconds
    $launcherText = ($launcherOut -join "`n")
    $launcher = $null
    try { $launcher = $launcherText.Substring($launcherText.IndexOf('{')) | ConvertFrom-Json } catch { }
    $outcome = if ($launcher) { $launcher.Outcome } else { 'unknown' }
    $job = $null
    $stdout = Join-Path $runDir 'stdout.txt'
    if (Test-Path -LiteralPath $stdout) {
        $raw = [IO.File]::ReadAllText($stdout)
        if ($raw.Contains('{')) { try { $job = $raw.Substring($raw.IndexOf('{')) | ConvertFrom-Json } catch { } }
    }
    # The kit appends every step to progress.log as it starts: after a timeout its last line is the call that hung.
    $progress = @()
    $progressPath = Join-Path $runDir 'progress.log'
    # Plain .NET strings: Get-Content output carries PSDrive/PSProvider note properties that ConvertTo-Json -Depth 20
    # walks for minutes.
    if (Test-Path -LiteralPath $progressPath) { $progress = @([IO.File]::ReadAllLines($progressPath) | Select-Object -Last 12 | ForEach-Object { [string]$_ }) }
    $summary = [pscustomobject]@{
        Stage = 'run'
        Outcome = $outcome
        LastSteps = $progress
        Ok = [bool]($job -and $job.Ok)
        Error = if ($job) { $job.Error } elseif ($launcher) { $launcher.Error } else { $launcherText }
        # The unary comma keeps one-element arrays as arrays: an if-expression unrolls them into a bare value.
        Result = if ($job) { ,$job.Result } else { $null }
        Log = if ($job) { ,@($job.Log) } else { ,@() }
        RunDirectory = $runDir
        TimedOut = [bool]($launcher -and $launcher.TimedOut)
        Memory = $null
    }
    # Long sessions leak: SLDWORKS private memory grows with every opened/created document, and when Windows' commit
    # charge runs out SOLIDWORKS shows a "critically low on memory" prompt before EVERY command (jobs then time out).
    try {
        $os = Get-CimInstance Win32_OperatingSystem
        $sw = @(Get-Process -Name SLDWORKS -ErrorAction SilentlyContinue | Sort-Object PrivateMemorySize64 -Descending | Select-Object -First 1)
        $freeCommitGB = [math]::Round($os.FreeVirtualMemory / 1MB, 1)
        $swGB = if ($sw.Count -gt 0) { [math]::Round($sw[0].PrivateMemorySize64 / 1GB, 1) } else { 0 }
        $summary.Memory = [pscustomobject]@{
            SolidWorksPrivateGB = $swGB
            FreeCommitGB = $freeCommitGB
            Advice = if ($freeCommitGB -lt 8 -or $swGB -gt 16) { 'Restart SOLIDWORKS soon: close all documents, ExitApp from a job, relaunch.' } else { '' }
        }
    } catch { }
    if ($summary.TimedOut -or $outcome -eq 'unknown') { Out-Json $summary 2 }
    if ($summary.Ok) { Out-Json $summary 0 }
    Out-Json $summary 1
} catch {
    Out-Json ([pscustomobject]@{ Stage = 'wrapper'; Ok = $false; Error = $_.Exception.Message }) 4
}
