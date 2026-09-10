<#
.SYNOPSIS
Offline contract regressions for the SOLIDWORKS skill helpers.
.DESCRIPTION
Run in 64-bit Windows PowerShell 5.1 with -NoProfile -STA. Compiles the exact
bridge source against fictional managed interfaces defined below. Never loads
installed SOLIDWORKS interop, calls Attach, accesses a CAD session, or starts CAD.
Child processes only isolate managed bridge types and the probe's exit behavior.
#>
[CmdletBinding()]
param(
    [string] $SkillRoot,
    [ValidateSet('All','Core','LegacyBridge','StaleBridge','ProbeNoSession')][string] $Case = 'All',
    [string] $OutputPath
)
$ErrorActionPreference = 'Stop'
if (-not $PSBoundParameters.ContainsKey('SkillRoot')) { $SkillRoot = Join-Path $PSScriptRoot '..\..\.agents\skills\solidworks' }
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion -lt [version]'5.1' -or
    -not [Environment]::Is64BitProcess -or [Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
    throw 'Run this harness in 64-bit Windows PowerShell 5.1 with -NoProfile -STA.'
}
$SkillRoot = (Get-Item -LiteralPath $SkillRoot -ErrorAction Stop).FullName
$helperPath = Join-Path $SkillRoot 'scripts\connect-solidworks.ps1'
$probePath = Join-Path $SkillRoot 'scripts\probe-solidworks.ps1'
$checks = @()
function Assert-ReviewCondition {
    param([string] $Name, [bool] $Condition)
    if (-not $Condition) { throw ('Regression failed: {0}' -f $Name) }
    $script:checks += [pscustomobject]@{Name=$Name;Passed=$true}
}

if ($Case -eq 'All') {
    $caseResults = @()
    foreach ($childCase in @('Core','LegacyBridge','StaleBridge','ProbeNoSession')) {
        $childOutput = & (Join-Path $PSHOME 'powershell.exe') -NoProfile -STA -File $PSCommandPath -SkillRoot $SkillRoot -Case $childCase
        if ($LASTEXITCODE -ne 0) { throw ('Offline case {0} failed with exit {1}: {2}' -f $childCase,$LASTEXITCODE,($childOutput -join "`n")) }
        $caseResults += ($childOutput -join "`n") | ConvertFrom-Json
    }
    $summary = [pscustomobject]@{
        Scope='Offline fictional managed stubs only; no SOLIDWORKS/native session calls'
        ObservedAtUtc=[DateTime]::UtcNow.ToString('o')
        Passed=$true
        CheckCount=(@($caseResults | ForEach-Object Checks).Count)
        HelperSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $helperPath).Hash.ToLower()
        ProbeSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $probePath).Hash.ToLower()
        Cases=$caseResults
    }
    $json = $summary | ConvertTo-Json -Depth 20
    if ($OutputPath) { $json | Set-Content -Encoding utf8 -LiteralPath $OutputPath }
    $json
    exit 0
}

. $helperPath
$definition = Get-SolidWorksBridgeDefinition
if ($Case -eq 'ProbeNoSession') {
    # The actual CLI helper will call this managed PowerShell stub, not the
    # real process-discovery cmdlet. Any unexpected compilation fails first.
    function Get-Process { param($Name, $ErrorAction) @() }
    function Add-Type { throw 'Unexpected bridge compilation in absent-session test.' }
    $probeOutput = & $probePath
    $probeExit = $LASTEXITCODE
    $probeResult = ($probeOutput -join "`n") | ConvertFrom-Json
    Assert-ReviewCondition 'CLI absent-session exits 1' ($probeExit -eq 1)
    Assert-ReviewCondition 'CLI preserves legacy Error text' ($probeResult.Error -like 'SW_NOT_RUNNING:*')
    Assert-ReviewCondition 'CLI emits structured error code and HRESULT' ($probeResult.ErrorDetails.Code -eq 'SW_NOT_RUNNING' -and $null -ne $probeResult.ErrorDetails.RootCause.HResultHex)
    Assert-ReviewCondition 'CLI emits schema 2' ($probeResult.SchemaVersion -eq 2)
} elseif ($Case -eq 'LegacyBridge') {
    Add-Type -TypeDefinition 'namespace SolidWorksSkill { public static class ReadOnlySessionV1 { public const string Evidence = "fictional older bridge"; } }'
    function Get-Process { throw 'Unexpected process discovery after a stale bridge.' }
    $caught = $null
    try { Connect-SolidWorks | Out-Null } catch { $caught = $_.Exception.Message }
    Assert-ReviewCondition 'Legacy bridge rejected before process discovery' ($caught -like 'SW_BRIDGE_CONFLICT:*older ReadOnlySessionV1*')
} else {
    $stubs = @'
namespace SolidWorks.Interop.swconst {
    public enum swDocumentTypes_e { swDocNONE=0, swDocPART=1, swDocASSEMBLY=2, swDocDRAWING=3 }
}
namespace SolidWorks.Interop.sldworks {
    public interface IModelDoc2 { int GetType(); string GetTitle(); string GetPathName(); bool GetSaveFlag(); }
    public interface ISldWorks {
        int GetProcessID(); int GetDocumentCount(); IModelDoc2 IActiveDoc2 {get;}
        object GetDocuments(); string RevisionNumber(); string GetExecutablePath();
    }
}
namespace OfflineSolidWorksRegression {
    public sealed class Document : SolidWorks.Interop.sldworks.IModelDoc2 {
        public string Name; public string Path; public bool Dirty;
        public Document(string name) { Name=name; Path="C:/Fictional/"+name+".SLDPRT"; }
        public new int GetType() { return 1; }
        public string GetTitle() { return Name; }
        public string GetPathName() { return Path; }
        public bool GetSaveFlag() { return Dirty; }
    }
    public sealed class Session : SolidWorks.Interop.sldworks.ISldWorks {
        public string Mode="Stable";
        public Document A=new Document("A"); public Document B=new Document("B");
        private int arrayReads; private int activeReads; private int pidReads;
        public int GetProcessID() {
            pidReads++;
            if (Mode=="Rejected") throw new System.Runtime.InteropServices.COMException("Fictional busy call",unchecked((int)0x80010001));
            if (Mode=="Disconnected") throw new System.Runtime.InteropServices.COMException("Fictional disconnected call",unchecked((int)0x80010108));
            if (Mode=="ProcessChanges" && pidReads>1) return 456;
            return 123;
        }
        public int GetDocumentCount() {
            if (Mode=="EmptyNull" || Mode=="EmptyArray") return 0;
            if (Mode=="Stable" || Mode=="Reordered" || Mode=="Unnamed" || Mode=="ActiveSwitch" || Mode=="Duplicate") return 2;
            return 1;
        }
        public SolidWorks.Interop.sldworks.IModelDoc2 IActiveDoc2 {
            get {
                activeReads++;
                if (Mode=="EmptyNull" || Mode=="EmptyArray" || Mode=="Replacement" || Mode=="SamePathReplacement" || Mode=="NullArray" || Mode=="NullEntry" || Mode=="MalformedEntry" || Mode=="MalformedArray" || Mode=="Multidimensional") return null;
                if (Mode=="ActiveSwitch" && activeReads>1) return B;
                return A;
            }
        }
        public object GetDocuments() {
            arrayReads++;
            if (Mode=="EmptyNull" || Mode=="NullArray") return null;
            if (Mode=="EmptyArray") return new object[0];
            if (Mode=="NullEntry") return new object[] {null};
            if (Mode=="MalformedEntry") return new object[] {"not a document"};
            if (Mode=="MalformedArray") return "not an array";
            if (Mode=="Multidimensional") return new object[1,1];
            if (Mode=="Duplicate") return new object[] {A,A};
            if (Mode=="ActiveMismatch") return new object[] {B};
            if (Mode=="Replacement" || Mode=="SamePathReplacement") {
                if (Mode=="SamePathReplacement") B.Path=A.Path;
                return new object[] {arrayReads==1 ? A : B};
            }
            if (Mode=="Rename" && arrayReads>1) A.Path="C:/Fictional/renamed.SLDPRT";
            if (Mode=="DirtyChange" && arrayReads>1) A.Dirty=true;
            if (Mode=="Unnamed") { A.Path=""; B.Path=""; }
            if (Mode=="Stable" || Mode=="Unnamed" || Mode=="ActiveSwitch") return new object[] {A,B};
            if (Mode=="Reordered") return arrayReads==1 ? new object[] {A,B} : new object[] {B,A};
            return new object[] {A};
        }
        public string RevisionNumber() { return "fictional-managed-stub"; }
        public string GetExecutablePath() { return "C:/Fictional"; }
    }
}
'@
    $compileSource = $definition.CompiledSource
    if ($Case -eq 'StaleBridge') { $compileSource = $compileSource.Replace($definition.SourceFingerprint, 'fictional-older-fingerprint') }
    Add-Type -TypeDefinition ($compileSource + "`n" + $stubs) -ErrorAction Stop
    if ($Case -eq 'StaleBridge') {
        function Get-Process { throw 'Unexpected process discovery after a stale bridge.' }
        $caught = $null
        try { Connect-SolidWorks | Out-Null } catch { $caught = $_.Exception.Message }
        Assert-ReviewCondition 'Changed bridge source rejected before process discovery' ($caught -like 'SW_BRIDGE_CONFLICT:*does not match*')
    } else {
        Assert-SolidWorksBridgeCompatibility -Definition $definition
        Assert-ReviewCondition 'Compiled bridge fingerprint matches exact public source' ([SolidWorksSkill.ReadOnlySessionV2]::SourceFingerprint -eq $definition.SourceFingerprint)
        foreach ($mode in @('Stable','Reordered','Unnamed','EmptyNull','EmptyArray')) {
            $session = New-Object OfflineSolidWorksRegression.Session
            $session.Mode = $mode
            $connection = [pscustomobject]@{Application=$session;ProcessId=123;BridgeSourceFingerprint=$definition.SourceFingerprint;AttachAttempts=@()}
            $result = Get-SolidWorksSessionInfo -Connection $connection
            $expectedCount = if ($mode -like 'Empty*') {0} else {2}
            Assert-ReviewCondition ('Consistent {0} metadata succeeds' -f $mode) ($result.DocumentCount -eq $expectedCount -and @($result.OpenDocuments).Count -eq $expectedCount)
            Assert-ReviewCondition ('{0} report labels observation non-atomic' -f $mode) ($result.ConsistencyCheck -like '*non-atomic*' -and $result.SnapshotStartedAtUtc -and $result.SnapshotFinishedAtUtc)
        }
        foreach ($mode in @('ActiveMismatch','Replacement','SamePathReplacement','ActiveSwitch','Rename','DirtyChange','NullArray','NullEntry','MalformedEntry','MalformedArray','Multidimensional','Duplicate','ProcessChanges')) {
            $session = New-Object OfflineSolidWorksRegression.Session
            $session.Mode = $mode
            $caught = $null
            try { Get-SolidWorksSessionInfo -Connection ([pscustomobject]@{Application=$session;ProcessId=123;BridgeSourceFingerprint=$definition.SourceFingerprint}) | Out-Null }
            catch { $caught = ConvertTo-SolidWorksErrorInfo -Exception $_.Exception }
            Assert-ReviewCondition ('Reject {0} instead of successful metadata' -f $mode) ($null -ne $caught -and $caught.Code -eq 'SW_METADATA')
        }
        foreach ($mode in @('Rejected','Disconnected')) {
            $session = New-Object OfflineSolidWorksRegression.Session
            $session.Mode = $mode
            $caught = $null
            try { Get-SolidWorksSessionInfo -Connection ([pscustomobject]@{Application=$session;ProcessId=123;BridgeSourceFingerprint=$definition.SourceFingerprint}) | Out-Null }
            catch { $caught = ConvertTo-SolidWorksErrorInfo -Exception $_.Exception }
            $expectedCode = if ($mode -eq 'Rejected') {'0x80010001'} else {'0x80010108'}
            Assert-ReviewCondition ('Preserve {0} original HRESULT' -f $mode) ($caught.RootCause.HResultHex -eq $expectedCode)
            Assert-ReviewCondition ('Preserve {0} exception chain and stage' -f $mode) ($caught.ExceptionChain.Count -gt 1 -and $caught.Stage -eq 'InspectMetadata' -and $caught.RootCause.ExceptionType -eq 'System.Runtime.InteropServices.COMException')
            $serialized = $caught | ConvertTo-Json -Depth 16 | ConvertFrom-Json
            Assert-ReviewCondition ('{0} error survives JSON serialization' -f $mode) ($serialized.RootCause.HResultHex -eq $expectedCode)
        }
        $firstCause = [Runtime.InteropServices.COMException]::new('Fictional first attach failure', [int]-2147418111)
        $lastCause = [Runtime.InteropServices.COMException]::new('Fictional second attach failure', [int]-2147417848)
        $attempts = @(
            [pscustomobject]@{ProgId='Fictional.Versioned';Stage='AttachRunningObject';ErrorDetails=(ConvertTo-SolidWorksErrorInfo -Exception $firstCause)},
            [pscustomobject]@{ProgId='Fictional.Fallback';Stage='AttachRunningObject';ErrorDetails=(ConvertTo-SolidWorksErrorInfo -Exception $lastCause)}
        )
        $attachError = New-SolidWorksContextException -Code 'SW_ATTACH' -Stage 'AttachRunningObject' -Message 'Fictional attach attempts exhausted' -InnerException $lastCause -AttachAttempts $attempts
        $attachInfo = ConvertTo-SolidWorksErrorInfo -Exception $attachError
        Assert-ReviewCondition 'Preserve every fictional attach attempt diagnosis' ($attachInfo.AttachAttempts.Count -eq 2 -and $attachInfo.AttachAttempts[0].ErrorDetails.RootCause.HResultHex -eq '0x80010001' -and $attachInfo.AttachAttempts[1].ErrorDetails.RootCause.HResultHex -eq '0x80010108')
        Assert-ReviewCondition 'Attach wrapper retains final original cause' ($attachInfo.RootCause.HResultHex -eq '0x80010108' -and $attachInfo.Code -eq 'SW_ATTACH')
        . $helperPath
        Assert-SolidWorksBridgeCompatibility -Definition (Get-SolidWorksBridgeDefinition)
        Assert-ReviewCondition 'Unchanged helper may be dot-sourced again' $true
    }
}
[pscustomobject]@{Case=$Case;Passed=$true;Checks=$checks} | ConvertTo-Json -Depth 10
