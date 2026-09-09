<#
.SYNOPSIS
Runs one frozen PowerShell job in a separate, bounded helper process.
.DESCRIPTION
Requires 64-bit Windows PowerShell 5.1. JobPath is an existing literal .ps1
path. RunDirectory must not exist and its parent must exist. The new directory
inherits its parent's ACLs; choose a private evidence location. No existing
run is reused. RunDirectory cannot contain brackets or backticks because
Windows PowerShell 5.1 Start-Process redirection interprets them as patterns.
Literal JobPath and InputJsonPath support these characters. The copied job executes with PSScriptRoot and working directory
set to the run directory. It must be self-contained or receive explicit
dependency paths through an optional JSON file; sibling files are not copied.

An input file is copied byte for byte and passed as -InputJsonPath. JSON keys
are never converted into command-line arguments. Jobs should declare this
parameter when input is provided and signal failure by throwing or exiting
nonzero. A returned outcome records successful helper return, not CAD quality.

TimeoutSeconds is 1..3600 (default 30). The monotonic deadline begins before
the synchronous Start-Process call. On expiration only the retained, owned
helper process is killed, with at most 5 seconds of termination waiting.
Terminating this helper does not cancel an in-flight SOLIDWORKS call. Timeout
therefore remains unknown. This script never discovers, starts, kills, or
retries SOLIDWORKS. Process creation and OS termination are not hard real-time.
Jobs must await their own subprocesses if synchronous completion is required.
Unawaited descendants can survive a returned helper and retain inherited host
pipe handles; this launcher cannot bound an outer host's output collection.

Stdout is result JSON. Exit codes: 0 returned, 1 failed, 2 unknown. Parameter
binding errors use PowerShell's normal error output. launch.json, child.json,
child-result.json, stdout.txt, stderr.txt and result.json are run evidence.
Snapshots attest bytes copied before launch, not arbitrary job dependencies.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $JobPath,
    [Parameter(Mandatory = $true)][string] $RunDirectory,
    [string] $InputJsonPath,
    [ValidateRange(1, 3600)][int] $TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-NewBytes([string] $Path, [byte[]] $Bytes) {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $stream.Write($Bytes, 0, $Bytes.Length); $stream.Flush() } finally { $stream.Dispose() }
}
function Write-NewJson([string] $Path, $Value) {
    Write-NewBytes -Path $Path -Bytes $utf8.GetBytes(($Value | ConvertTo-Json -Depth 16))
}
function Get-BytesHash([byte[]] $Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function Resolve-LiteralFile([string] $Path, [string] $Extension) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($item.PSProvider.Name -ne 'FileSystem' -or $item.PSIsContainer) { throw "Expected a filesystem file: $Path" }
    if ($Extension -and $item.Extension -ine $Extension) { throw "Expected a $Extension file: $Path" }
    return $item.FullName
}
function New-Snapshot([string] $Source, [string] $Destination) {
    $bytes = [IO.File]::ReadAllBytes($Source)
    Write-NewBytes -Path $Destination -Bytes $bytes
    return [pscustomobject]@{
        OriginalPath = $Source; SnapshotPath = $Destination; Length = $bytes.Length
        Sha256 = Get-BytesHash $bytes; CapturedAtUtc = [DateTime]::UtcNow.ToString('o')
    }
}
function Get-ErrorDescription($Record) {
    $chain = @()
    $exception = $Record.Exception
    while ($null -ne $exception) {
        $chain += [pscustomobject]@{Type=$exception.GetType().FullName; Message=$exception.Message; HResult=$exception.HResult; HResultHex=('0x{0:X8}' -f $exception.HResult)}
        $exception = $exception.InnerException
    }
    return [pscustomobject]@{Message=$Record.Exception.Message; ExceptionChain=$chain}
}

$startedAt = [DateTime]::UtcNow
$runCreated = $false
$ownedProcess = $null
$drainTask = $null
$clock = $null
$childIdentity = $null
$result = [ordered]@{
    SchemaVersion=1; AttemptId=[Guid]::NewGuid().ToString('D'); Outcome='failed'; TimedOut=$false
    LauncherStartedAtUtc=$startedAt.ToString('o'); FinishedAtUtc=$null
    RunDirectory=$null; TimeoutSeconds=$TimeoutSeconds; LaunchRequestedAtUtc=$null; DeadlineUtc=$null
    ElapsedSeconds=$null; Job=$null; Input=$null; Runner=$null; Child=$null; ChildExitCode=$null
    ChildResult=$null; StdoutPath=$null; StderrPath=$null; OutputCaptureComplete=$false
    Cleanup=[ordered]@{Attempted=$false; OwnedHelperStopped=$null; WaitLimitSeconds=5; Error=$null}
    NativeCallMayStillBeRunning=$false; Limitation=$null; Error=$null
    OutcomeScope='Owned helper and its redirected streams only. Returned does not verify CAD state or completion of unawaited subprocesses; descendants can retain outer host pipe handles.'
}

try {
    if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or
        $PSVersionTable.PSVersion.Minor -ne 1 -or -not [Environment]::Is64BitProcess) {
        throw 'Run this launcher in 64-bit Windows PowerShell 5.1.'
    }
    # WaitForExit(Int32) alone need not drain redirected async output. Run the
    # full exit-and-drain wait on a managed thread, then bound that task with
    # the same deadline. No PowerShell runspace or application API is used.
    Add-Type -TypeDefinition @'
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
namespace SolidWorksSkill {
    public static class BoundedProcessDrainV1 {
        public static Task Begin(Process process) {
            return Task.Factory.StartNew(delegate { process.WaitForExit(); },
                CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
        }
    }
}
'@ -ErrorAction Stop
    $jobSource = Resolve-LiteralFile -Path $JobPath -Extension '.ps1'
    $inputSource = $null
    if ($PSBoundParameters.ContainsKey('InputJsonPath')) {
        $inputSource = Resolve-LiteralFile -Path $InputJsonPath -Extension ''
        $inputText = [IO.File]::ReadAllText($inputSource)
        if ([string]::IsNullOrWhiteSpace($inputText)) { throw 'InputJsonPath must contain JSON.' }
        $null = ConvertFrom-Json -InputObject $inputText -ErrorAction Stop
    }
    $runPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($RunDirectory)
    $runPath = [IO.Path]::GetFullPath($runPath).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if ($runPath.IndexOfAny([char[]]'[]`') -ge 0) { throw 'RunDirectory cannot contain brackets or backticks: Windows PowerShell 5.1 Start-Process redirection treats them as patterns.' }
    if ([IO.Directory]::Exists($runPath) -or [IO.File]::Exists($runPath)) { throw "RunDirectory already exists: $runPath" }
    $parentPath = [IO.Path]::GetDirectoryName($runPath)
    if (-not [IO.Directory]::Exists($parentPath)) { throw "RunDirectory parent must already exist: $parentPath" }
    # No -Force; snapshots and manifests also use CreateNew to reject overwrites.
    $null = New-Item -ItemType Directory -Path $runPath -ErrorAction Stop
    $runCreated = $true
    $result.RunDirectory = $runPath
    $result.Job = New-Snapshot -Source $jobSource -Destination (Join-Path $runPath 'job.ps1')
    if ($null -ne $inputSource) {
        $result.Input = New-Snapshot -Source $inputSource -Destination (Join-Path $runPath 'input.json')
        # Validate the copied bytes as well, in case the source changed after preflight.
        $copiedInput = [IO.File]::ReadAllText($result.Input.SnapshotPath)
        if ([string]::IsNullOrWhiteSpace($copiedInput)) { throw 'Copied input must contain JSON.' }
        $null = ConvertFrom-Json -InputObject $copiedInput -ErrorAction Stop
    }
    $runnerSource = @'
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$report = [ordered]@{SchemaVersion=1; StartedAtUtc=[DateTime]::UtcNow.ToString('o'); FinishedAtUtc=$null; JobInvoked=$false; JobReturned=$false; ExitCode=1; Error=$null; Runtime=$null}
$jobExitCode = 1
try {
    $report.Runtime = [pscustomobject]@{Version=$PSVersionTable.PSVersion.ToString(); Edition=$PSVersionTable.PSEdition; Is64Bit=[Environment]::Is64BitProcess; ApartmentState=[Threading.Thread]::CurrentThread.GetApartmentState().ToString()}
    if ($report.Runtime.Edition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or -not $report.Runtime.Is64Bit -or $report.Runtime.ApartmentState -ne 'STA') { throw 'Unexpected child runtime; requires 64-bit Windows PowerShell 5.1 STA.' }
    $config = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'launch.json')) | ConvertFrom-Json
    $jobPath = Join-Path $PSScriptRoot 'job.ps1'
    if ((Get-FileHash -LiteralPath $jobPath -Algorithm SHA256).Hash -ine $config.Job.Sha256) { throw 'Job snapshot hash changed before invocation.' }
    $arguments = @{}
    if ($null -ne $config.Input) {
        $inputPath = Join-Path $PSScriptRoot 'input.json'
        if ((Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash -ine $config.Input.Sha256) { throw 'Input snapshot hash changed before invocation.' }
        $arguments.InputJsonPath = $inputPath
    }
    $global:LASTEXITCODE = 0
    $report.JobInvoked = $true
    & $jobPath @arguments
    $invocationSucceeded = $?
    $jobExitCode = [int] $global:LASTEXITCODE
    if (-not $invocationSucceeded -and $jobExitCode -eq 0) { $jobExitCode = 1 }
    $report.JobReturned = $true
} catch {
    $jobExitCode = 1
    $report.Error = [pscustomobject]@{Message=$_.Exception.Message; Type=$_.Exception.GetType().FullName; HResult=$_.Exception.HResult; HResultHex=('0x{0:X8}' -f $_.Exception.HResult)}
    [Console]::Error.WriteLine($_.ToString())
} finally {
    $report.ExitCode = $jobExitCode
    $report.FinishedAtUtc = [DateTime]::UtcNow.ToString('o')
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($report | ConvertTo-Json -Depth 8))
    $stream = [IO.File]::Open((Join-Path $PSScriptRoot 'child-result.json'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush() } finally { $stream.Dispose() }
}
exit $jobExitCode
'@
    $runnerPath = Join-Path $runPath 'runner.ps1'
    $runnerBytes = $utf8.GetBytes($runnerSource)
    Write-NewBytes -Path $runnerPath -Bytes $runnerBytes
    $result.Runner = [pscustomobject]@{SnapshotPath=$runnerPath; Sha256=Get-BytesHash $runnerBytes}
    $result.StdoutPath = Join-Path $runPath 'stdout.txt'
    $result.StderrPath = Join-Path $runPath 'stderr.txt'
    $childExecutable = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
    if (-not [IO.File]::Exists($childExecutable)) { throw "Windows PowerShell executable missing: $childExecutable" }
    # Windows filenames cannot contain a double quote. The quoted, fixed runner
    # filename cannot end in a backslash; user JSON is never in ArgumentList.
    $childArguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', ('"{0}"' -f $runnerPath))
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $launchAt = [DateTime]::UtcNow
    $result.LaunchRequestedAtUtc = $launchAt.ToString('o')
    $result.DeadlineUtc = $launchAt.AddSeconds($TimeoutSeconds).ToString('o')
    Write-NewJson -Path (Join-Path $runPath 'launch.json') -Value ([ordered]@{
        SchemaVersion=1; AttemptId=$result.AttemptId; Job=$result.Job; Input=$result.Input; Runner=$result.Runner
        ChildExecutable=$childExecutable; Arguments=$childArguments; WorkingDirectory=$runPath
        LaunchRequestedAtUtc=$result.LaunchRequestedAtUtc; DeadlineUtc=$result.DeadlineUtc; TimeoutSeconds=$TimeoutSeconds
        DependencyScope='Only job.ps1, input.json (when supplied), and runner.ps1 are snapshotted. External dependencies are not frozen.'
    })
    $ownedProcess = Start-Process -FilePath $childExecutable -ArgumentList $childArguments -WorkingDirectory $runPath -WindowStyle Hidden -RedirectStandardOutput $result.StdoutPath -RedirectStandardError $result.StderrPath -PassThru -ErrorAction Stop
    # Retain the original process handle; cleanup never looks up a process by
    # name or reopens a PID that may have been reused, and never kills a tree.
    $ownedHandle = $ownedProcess.Handle
    $drainTask = [SolidWorksSkill.BoundedProcessDrainV1]::Begin($ownedProcess)
    $childIdentity = [pscustomobject]@{Executable=$childExecutable; Pid=$ownedProcess.Id; StartedAtUtc=$ownedProcess.StartTime.ToUniversalTime().ToString('o'); IdentitySource='Retained Start-Process Process object and original process handle'}
    $result.Child = $childIdentity
    Write-NewJson -Path (Join-Path $runPath 'child.json') -Value $childIdentity
    $remainingMilliseconds = [Math]::Max(0, [int][Math]::Ceiling(($TimeoutSeconds * 1000) - $clock.Elapsed.TotalMilliseconds))
    $finished = $drainTask.Wait($remainingMilliseconds)
    if (-not $finished) {
        $result.TimedOut = $true
        $result.Outcome = 'unknown'
        $result.NativeCallMayStillBeRunning = $true
        $result.Limitation = 'The deadline expired before helper exit and output drain completed. Stopping the owned helper does not cancel an in-flight SOLIDWORKS call. Inspect the session and evidence before deciding any further action.'
        $result.Cleanup.Attempted = $true
        try {
            if (-not $ownedProcess.HasExited) { $ownedProcess.Kill() }
            $result.Cleanup.OwnedHelperStopped = $ownedProcess.WaitForExit(5000)
        } catch { $result.Cleanup.Error = Get-ErrorDescription $_ }
    } else {
        $result.OutputCaptureComplete = $true
        $result.ChildExitCode = $ownedProcess.ExitCode
        $childReportPath = Join-Path $runPath 'child-result.json'
        if ([IO.File]::Exists($childReportPath)) {
            $result.ChildResult = [IO.File]::ReadAllText($childReportPath) | ConvertFrom-Json
        }
        if ($ownedProcess.ExitCode -ne 0) {
            $result.Outcome = 'failed'
            $result.Error = [pscustomobject]@{Message="Helper exited with code $($ownedProcess.ExitCode). Inspect stderr and ChildResult."}
        } elseif ($null -eq $result.ChildResult -or -not $result.ChildResult.JobReturned -or $result.ChildResult.ExitCode -ne 0) {
            $result.Outcome = 'unknown'
            $result.NativeCallMayStillBeRunning = $true
            $result.Limitation = 'The helper exited without a successful job-return receipt; job completion cannot be established.'
        } else { $result.Outcome = 'returned' }
    }
} catch {
    $result.Error = Get-ErrorDescription $_
    if ($null -ne $ownedProcess) {
        $result.Outcome = 'unknown'
        $result.NativeCallMayStillBeRunning = $true
        $result.Limitation = 'A launcher error occurred after child creation. Stopping the owned helper does not cancel an in-flight SOLIDWORKS call.'
        $result.Cleanup.Attempted = $true
        try {
            if (-not $ownedProcess.HasExited) { $ownedProcess.Kill() }
            $result.Cleanup.OwnedHelperStopped = $ownedProcess.WaitForExit(5000)
        } catch { $result.Cleanup.Error = Get-ErrorDescription $_ }
    }
} finally {
    if ($null -ne $clock) { $clock.Stop(); $result.ElapsedSeconds = $clock.Elapsed.TotalSeconds }
    if ($null -ne $ownedProcess) {
        try { if ($ownedProcess.HasExited) { $result.ChildExitCode = $ownedProcess.ExitCode } } catch { }
        if ($null -ne $drainTask -and $drainTask.Status -eq [Threading.Tasks.TaskStatus]::RanToCompletion) { $result.OutputCaptureComplete = $true }
        $ownedProcess.Dispose()
    }
    $result.FinishedAtUtc = [DateTime]::UtcNow.ToString('o')
    if ($runCreated) {
        try { Write-NewJson -Path (Join-Path $result.RunDirectory 'result.json') -Value $result }
        catch {
            $result.Outcome = 'unknown'
            $result.Limitation = 'The final result could not be persisted; inspect stdout and the run directory.'
            $result.Error = Get-ErrorDescription $_
        }
    }
}
$result | ConvertTo-Json -Depth 16
switch ($result.Outcome) { 'returned' { exit 0 }; 'failed' { exit 1 }; default { exit 2 } }
