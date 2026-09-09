<#
.SYNOPSIS
Runs process-control regressions using fictional PowerShell jobs only.
.DESCRIPTION
Requires 64-bit Windows PowerShell 5.1 STA. Does not discover or call CAD,
COM, installed interop, or the real probe. Fake probe/connect scripts live in
a new temporary skill fixture. Run artifacts are preserved for inspection.
OutputDirectory must be a new directory whose parent exists. If omitted, a
unique directory in TEMP is used. No existing test results are overwritten.
#>
[CmdletBinding()]
param([string] $SkillRoot, [string] $OutputDirectory)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or
    $PSVersionTable.PSVersion.Minor -ne 1 -or -not [Environment]::Is64BitProcess -or
    [Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    throw 'Use 64-bit Windows PowerShell 5.1 -STA.'
}
if (-not $SkillRoot) { $SkillRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.agents/skills/solidworks')) }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $env:TEMP ('solidworks-launcher-tests-' + [Guid]::NewGuid().ToString('N')) }
$testRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
if (Test-Path -LiteralPath $testRoot) { throw 'OutputDirectory must not exist.' }
$null = New-Item -ItemType Directory -Path $testRoot -ErrorAction Stop
$launcher = (Get-Item -LiteralPath (Join-Path $SkillRoot 'scripts/invoke-solidworks-job.ps1')).FullName
$probeJob = (Get-Item -LiteralPath (Join-Path $SkillRoot 'scripts/jobs/probe-session.ps1')).FullName
$powershell = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
$utf8 = New-Object Text.UTF8Encoding($false)
$checks = New-Object 'System.Collections.Generic.List[object]'
$runs = New-Object 'System.Collections.Generic.List[object]'
function Assert-Check([string] $Name, [bool] $Condition) {
    $checks.Add([pscustomobject]@{Name=$Name; Passed=$Condition})
    if (-not $Condition) { throw "Regression failed: $Name" }
}
function Write-Fixture([string] $Path, [string] $Content) { [IO.File]::WriteAllText($Path, $Content, $utf8) }
function Invoke-Fixture([string] $Name, [string] $Job, [string] $InputFile, [int] $Seconds = 10, [string] $RunPath) {
    if (-not $RunPath) { $RunPath = Join-Path $testRoot $Name }
    $arguments = @('-NoProfile', '-STA', '-File', $launcher, '-JobPath', $Job, '-RunDirectory', $RunPath, '-TimeoutSeconds', $Seconds)
    if ($InputFile) { $arguments += @('-InputJsonPath', $InputFile) }
    # Native invocation's argument array preserves spaces; the launcher itself
    # uses Start-Process with its own fixed, quoted runner path.
    $stdout = (& $powershell @arguments | Out-String)
    $exitCode = $LASTEXITCODE
    $json = $stdout | ConvertFrom-Json
    $record = [pscustomobject]@{Name=$Name; ExitCode=$exitCode; Result=$json}
    $runs.Add($record)
    return $record
}

$testError = $null
try {
    $sourceDir = Join-Path $testRoot "source [literal] ' files"
    $null = New-Item -ItemType Directory -Path $sourceDir
    $successJob = Join-Path $sourceDir 'fictional success.ps1'
    Write-Fixture $successJob @'
param([Parameter(Mandatory=$true)][string] $InputJsonPath)
$data = [IO.File]::ReadAllText($InputJsonPath) | ConvertFrom-Json
[pscustomobject]@{Payload=$data; Root=$PSScriptRoot; Directory=(Get-Location).ProviderPath; InputPath=$InputJsonPath; Pid=$PID} | ConvertTo-Json -Depth 8
[Console]::Error.WriteLine('fictional stderr')
exit 0
'@
    $inputPath = Join-Path $sourceDir 'input [literal] payload.json'
    $payload = [pscustomobject]@{Message="space ' quote `" double `" and newline`nline two"; Literal='$HOME; $(throw "must stay literal"); & other'; Items=@('one two', 'three', '[brackets]'); Flag=$true}
    Write-Fixture $inputPath ($payload | ConvertTo-Json -Depth 8)
    $success = Invoke-Fixture -Name "successful run ' with spaces" -Job $successJob -InputFile $inputPath
    Assert-Check 'success returns CLI zero and returned outcome' ($success.ExitCode -eq 0 -and $success.Result.Outcome -eq 'returned')
    Assert-Check 'job snapshot preserves source bytes' ($success.Result.Job.Sha256 -eq (Get-FileHash -LiteralPath $successJob).Hash.ToLowerInvariant() -and $success.Result.Job.Sha256 -eq (Get-FileHash -LiteralPath $success.Result.Job.SnapshotPath).Hash.ToLowerInvariant())
    Assert-Check 'input snapshot preserves source bytes' ($success.Result.Input.Sha256 -eq (Get-FileHash -LiteralPath $inputPath).Hash.ToLowerInvariant() -and $success.Result.Input.Sha256 -eq (Get-FileHash -LiteralPath $success.Result.Input.SnapshotPath).Hash.ToLowerInvariant())
    $successOutput = [IO.File]::ReadAllText($success.Result.StdoutPath) | ConvertFrom-Json
    Assert-Check 'JSON input preserves all argument boundaries and literal text' (($successOutput.Payload | ConvertTo-Json -Depth 8 -Compress) -ceq ($payload | ConvertTo-Json -Depth 8 -Compress))
    Assert-Check 'job runs from frozen copy in new working directory' ($successOutput.Root -eq $success.Result.RunDirectory -and $successOutput.Directory -eq $success.Result.RunDirectory -and $successOutput.InputPath -eq $success.Result.Input.SnapshotPath)
    Assert-Check 'stderr captured independently of successful stdout' ([IO.File]::ReadAllText($success.Result.StderrPath).Trim() -eq 'fictional stderr')
    Assert-Check 'successful result waits for complete output capture' $success.Result.OutputCaptureComplete
    Assert-Check 'child runtime is 64-bit Windows PowerShell 5.1 STA' ($success.Result.ChildResult.Runtime.Edition -eq 'Desktop' -and $success.Result.ChildResult.Runtime.Version.StartsWith('5.1.') -and $success.Result.ChildResult.Runtime.Is64Bit -and $success.Result.ChildResult.Runtime.ApartmentState -eq 'STA')
    $launchReceipt = [IO.File]::ReadAllText((Join-Path $success.Result.RunDirectory 'launch.json')) | ConvertFrom-Json
    $childReceipt = [IO.File]::ReadAllText((Join-Path $success.Result.RunDirectory 'child.json')) | ConvertFrom-Json
    Assert-Check 'launch records deadline and process identity with copied-job hash' ($launchReceipt.Job.Sha256 -eq $success.Result.Job.Sha256 -and $childReceipt.Pid -eq $successOutput.Pid -and ([DateTime]$launchReceipt.LaunchRequestedAtUtc) -le ([DateTime]$childReceipt.StartedAtUtc) -and ([DateTime]$launchReceipt.DeadlineUtc) -gt ([DateTime]$childReceipt.StartedAtUtc))
    Assert-Check 'result.json matches returned final outcome' (([IO.File]::ReadAllText((Join-Path $success.Result.RunDirectory 'result.json')) | ConvertFrom-Json).Outcome -eq 'returned')

    $existingResultHash = (Get-FileHash -LiteralPath (Join-Path $success.Result.RunDirectory 'result.json')).Hash
    $existing = Invoke-Fixture -Name 'existing directory rejected' -Job $successJob -InputFile $inputPath -RunPath $success.Result.RunDirectory
    Assert-Check 'existing run is rejected without child creation' ($existing.ExitCode -eq 1 -and $existing.Result.Outcome -eq 'failed' -and $null -eq $existing.Result.Child)
    Assert-Check 'existing evidence is never overwritten' ((Get-FileHash -LiteralPath (Join-Path $success.Result.RunDirectory 'result.json')).Hash -eq $existingResultHash)

    $plainJob = Join-Path $sourceDir 'no input.ps1'
    Write-Fixture $plainJob 'Write-Output "fictional no-input return"'
    $plain = Invoke-Fixture -Name 'no input' -Job $plainJob
    Assert-Check 'optional input can be omitted' ($plain.ExitCode -eq 0 -and $null -eq $plain.Result.Input -and $plain.Result.ChildResult.JobReturned)
    # Exercise the public default without passing a TimeoutSeconds argument.
    $defaultRun = Join-Path $testRoot 'default deadline'
    $defaultText = (& $powershell -NoProfile -STA -File $launcher -JobPath $plainJob -RunDirectory $defaultRun | Out-String)
    $defaultCode = $LASTEXITCODE
    $defaultResult = $defaultText | ConvertFrom-Json
    $runs.Add([pscustomobject]@{Name='default deadline'; ExitCode=$defaultCode; Result=$defaultResult})
    Assert-Check 'default timeout is 30 seconds' ($defaultCode -eq 0 -and $defaultResult.TimeoutSeconds -eq 30 -and (([DateTime]$defaultResult.DeadlineUtc)-([DateTime]$defaultResult.LaunchRequestedAtUtc)).TotalSeconds -eq 30)

    $exitJob = Join-Path $sourceDir 'exit seven.ps1'
    Write-Fixture $exitJob 'Write-Output "fictional failure"; exit 7'
    $failure = Invoke-Fixture -Name 'nonzero exit' -Job $exitJob
    Assert-Check 'nonzero job exit remains failed with original exit code' ($failure.ExitCode -eq 1 -and $failure.Result.Outcome -eq 'failed' -and $failure.Result.ChildExitCode -eq 7 -and $failure.Result.ChildResult.ExitCode -eq 7)
    $throwJob = Join-Path $sourceDir 'throws.ps1'
    Write-Fixture $throwJob 'throw "fictional failure message"'
    $thrown = Invoke-Fixture -Name 'thrown error' -Job $throwJob
    Assert-Check 'thrown job error is a recorded failure' ($thrown.ExitCode -eq 1 -and $thrown.Result.Outcome -eq 'failed' -and $thrown.Result.ChildResult.Error.Message -eq 'fictional failure message' -and -not $thrown.Result.ChildResult.JobReturned)
    Assert-Check 'thrown error reaches stderr' ([IO.File]::ReadAllText($thrown.Result.StderrPath).Contains('fictional failure message'))

    $largeJob = Join-Path $sourceDir 'large output.ps1'
    Write-Fixture $largeJob '1..12000 | ForEach-Object { [Console]::Out.WriteLine(("{0:D5}:" -f $_) + ("x" * 120)); [Console]::Error.WriteLine(("{0:D5}:" -f $_) + ("e" * 120)) }; exit 0'
    $large = Invoke-Fixture -Name 'large redirected streams' -Job $largeJob -Seconds 15
    Assert-Check 'large stdout and stderr drain without truncation' ($large.ExitCode -eq 0 -and $large.Result.OutputCaptureComplete -and [IO.File]::ReadAllLines($large.Result.StdoutPath).Count -eq 12000 -and [IO.File]::ReadAllLines($large.Result.StderrPath).Count -eq 12000)

    $sleepJob = Join-Path $sourceDir 'sleeps.ps1'
    Write-Fixture $sleepJob '[IO.File]::WriteAllText((Join-Path $PSScriptRoot "entered.txt"), "fictional child entered"); Start-Sleep -Seconds 20; Write-Output "late"'
    $sentinelJob = Join-Path $testRoot 'unrelated fictional sentinel.ps1'
    Write-Fixture $sentinelJob 'Start-Sleep -Seconds 20'
    $sentinel = Start-Process -FilePath $powershell -ArgumentList @('-NoProfile', '-NonInteractive', '-STA', '-File', ('"{0}"' -f $sentinelJob)) -WindowStyle Hidden -PassThru
    $null = $sentinel.Handle
    try {
        $timed = Invoke-Fixture -Name 'deadline expiration' -Job $sleepJob -Seconds 2
        Assert-Check 'timeout leaves unrelated same-executable helper running' (-not $sentinel.HasExited)
    } finally {
        if (-not $sentinel.HasExited) { $sentinel.Kill() }
        $null = $sentinel.WaitForExit(5000)
        $sentinel.Dispose()
    }
    Assert-Check 'timeout returns unknown and CLI two' ($timed.ExitCode -eq 2 -and $timed.Result.Outcome -eq 'unknown' -and $timed.Result.TimedOut)
    Assert-Check 'timeout stops the owned helper only and records identity' ($timed.Result.Cleanup.Attempted -and $timed.Result.Cleanup.OwnedHelperStopped -and $null -eq $timed.Result.Cleanup.Error -and $timed.Result.Child.Pid -gt 0 -and $timed.Result.Child.Pid -ne $PID)
    Assert-Check 'timeout preserves native-call uncertainty' ($timed.Result.NativeCallMayStillBeRunning -and $timed.Result.Limitation.Contains('does not cancel an in-flight SOLIDWORKS call'))
    Assert-Check 'timeout is bounded with cleanup allowance' ($timed.Result.ElapsedSeconds -ge 2 -and $timed.Result.ElapsedSeconds -lt 9)
    Assert-Check 'timeout child started but did not return' ([IO.File]::Exists((Join-Path $timed.Result.RunDirectory 'entered.txt')) -and -not [IO.File]::Exists((Join-Path $timed.Result.RunDirectory 'child-result.json')))

    $earlyJob = Join-Path $sourceDir 'early process exit.ps1'
    Write-Fixture $earlyJob '[Environment]::Exit(0)'
    $early = Invoke-Fixture -Name 'missing return receipt' -Job $earlyJob
    Assert-Check 'zero process exit without job-return receipt is unknown' ($early.ExitCode -eq 2 -and $early.Result.ChildExitCode -eq 0 -and $early.Result.Outcome -eq 'unknown')

    $invalidJson = Join-Path $sourceDir 'invalid.json'
    Write-Fixture $invalidJson '{ invalid json'
    $invalid = Invoke-Fixture -Name 'invalid input' -Job $plainJob -InputFile $invalidJson
    Assert-Check 'invalid input fails before creating a run' ($invalid.ExitCode -eq 1 -and $null -eq $invalid.Result.Child -and -not (Test-Path -LiteralPath (Join-Path $testRoot 'invalid input')))
    $missing = Invoke-Fixture -Name 'missing job' -Job (Join-Path $sourceDir 'missing.ps1')
    Assert-Check 'missing job fails without creating a run' ($missing.ExitCode -eq 1 -and $null -eq $missing.Result.Child -and -not (Test-Path -LiteralPath (Join-Path $testRoot 'missing job')))
    $pattern = Invoke-Fixture -Name 'unsupported [run] path' -Job $plainJob
    Assert-Check 'unsupported run path is rejected before creating files' ($pattern.ExitCode -eq 1 -and $pattern.Result.Error.Message.Contains('brackets or backticks') -and -not (Test-Path -LiteralPath (Join-Path $testRoot 'unsupported [run] path')))

    # Fictional external dependencies verify the public probe job without
    # executing the real probe or discovering any application processes.
    $fakeSkill = Join-Path $testRoot "fictional installed [skill] ' path"
    $fakeScripts = Join-Path $fakeSkill 'scripts'
    $null = New-Item -ItemType Directory -Path $fakeScripts
    $fakeConnect = Join-Path $fakeScripts 'connect-solidworks.ps1'
    $fakeProbe = Join-Path $fakeScripts 'probe-solidworks.ps1'
    Write-Fixture $fakeConnect '# Fictional connector: no COM or application calls.'
    Write-Fixture $fakeProbe 'Write-Output ''{"Fictional":true}''; exit 0'
    $probeInput = Join-Path $sourceDir 'probe input.json'
    Write-Fixture $probeInput (@{skillRoot=$fakeSkill} | ConvertTo-Json)
    $probe = Invoke-Fixture -Name 'fictional probe receipt' -Job $probeJob -InputFile $probeInput
    Assert-Check 'self-contained probe job works with explicit dependency paths' ($probe.ExitCode -eq 0 -and $probe.Result.Outcome -eq 'returned' -and ([IO.File]::ReadAllText($probe.Result.StdoutPath) | ConvertFrom-Json).Fictional)
    $beforePath = Join-Path $probe.Result.RunDirectory 'probe-dependencies-before.json'
    $afterPath = Join-Path $probe.Result.RunDirectory 'probe-dependencies-after.json'
    $before = [IO.File]::ReadAllText($beforePath) | ConvertFrom-Json
    $after = [IO.File]::ReadAllText($afterPath) | ConvertFrom-Json
    Assert-Check 'probe records exact external script identities before and after' ($before.Files.Count -eq 2 -and $before.Files[0].Path -eq $fakeProbe -and $before.Files[1].Path -eq $fakeConnect -and $before.Files[0].Sha256 -eq (Get-FileHash -LiteralPath $fakeProbe).Hash.ToLowerInvariant() -and $after.Files[1].Sha256 -eq $before.Files[1].Sha256)
    Assert-Check 'probe receipts state unfrozen non-transitive dependency scope' ($before.Scope.Contains('not frozen or locked') -and $before.Scope.Contains('Transitive dependencies'))
    Write-Fixture $fakeProbe 'exit 9'
    $probeFailure = Invoke-Fixture -Name 'fictional probe failure' -Job $probeJob -InputFile $probeInput
    Assert-Check 'probe job propagates the external probe exit code' ($probeFailure.ExitCode -eq 1 -and $probeFailure.Result.ChildExitCode -eq 9)
    Write-Fixture $fakeProbe '[IO.File]::AppendAllText((Join-Path $PSScriptRoot "connect-solidworks.ps1"), "`n# altered by fictional probe"); exit 0'
    $changed = Invoke-Fixture -Name 'fictional dependency changes' -Job $probeJob -InputFile $probeInput
    Assert-Check 'observed dependency change rejects successful attribution' ($changed.ExitCode -eq 1 -and $changed.Result.Outcome -eq 'failed' -and $changed.Result.ChildResult.Error.Message.Contains('dependencies changed'))
    Write-Fixture $probeInput (@{skillRoot='C:'} | ConvertTo-Json)
    $relative = Invoke-Fixture -Name 'drive relative skill rejected' -Job $probeJob -InputFile $probeInput
    Assert-Check 'probe rejects drive-relative skillRoot' ($relative.ExitCode -eq 1 -and $relative.Result.ChildResult.Error.Message.Contains('absolute filesystem path'))
} catch { $testError = $_.ToString() }

$report = [pscustomobject]@{
    SchemaVersion=1; ObservedAtUtc=[DateTime]::UtcNow.ToString('o'); TestDirectory=$testRoot
    Runtime=$PSVersionTable.PSVersion.ToString(); NativeCadCallsMade=$false
    Sources=@([pscustomobject]@{Path=$launcher; Sha256=(Get-FileHash -LiteralPath $launcher).Hash.ToLowerInvariant()}, [pscustomobject]@{Path=$probeJob; Sha256=(Get-FileHash -LiteralPath $probeJob).Hash.ToLowerInvariant()})
    Passed=($null -eq $testError); CheckCount=$checks.Count; Checks=$checks.ToArray(); Error=$testError; Runs=$runs.ToArray()
}
[IO.File]::WriteAllText((Join-Path $testRoot 'test-results.json'), ($report | ConvertTo-Json -Depth 24), $utf8)
[pscustomobject]@{Passed=$report.Passed; CheckCount=$report.CheckCount; ResultsPath=(Join-Path $testRoot 'test-results.json'); Error=$testError} | ConvertTo-Json
if (-not $report.Passed) { exit 1 }
exit 0
