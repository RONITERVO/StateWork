# Dot-source this file, then call Connect-SolidWorks and Get-SolidWorksSessionInfo.
# Connection and metadata calls below are read-only. They never start SOLIDWORKS.

function New-SolidWorksContextException {
    param(
        [Parameter(Mandatory = $true)][string] $Code,
        [Parameter(Mandatory = $true)][string] $Stage,
        [Parameter(Mandatory = $true)][string] $Message,
        [Parameter(Mandatory = $true)][Exception] $InnerException,
        [object[]] $AttachAttempts = @()
    )
    $exception = [InvalidOperationException]::new(('{0}: {1}' -f $Code, $Message), $InnerException)
    $exception.Data['SolidWorksCode'] = $Code
    $exception.Data['SolidWorksStage'] = $Stage
    if ($AttachAttempts.Count -gt 0) { $exception.Data['SolidWorksAttachAttempts'] = $AttachAttempts }
    return $exception
}

function ConvertTo-SolidWorksErrorInfo {
    param([Parameter(Mandatory = $true)][Exception] $Exception)
    $chain = @()
    $code = $null
    $stage = $null
    $attempts = @()
    $current = $Exception
    while ($null -ne $current) {
        $chain += [pscustomobject]@{
            ExceptionType = $current.GetType().FullName
            Message = $current.Message
            HResult = $current.HResult
            HResultHex = ('0x{0:X8}' -f $current.HResult)
        }
        if ($null -eq $code -and $current.Data.Contains('SolidWorksCode')) { $code = $current.Data['SolidWorksCode'] }
        if ($null -eq $code -and $current.Message -match '^(SW_[A-Z_]+):') { $code = $Matches[1] }
        if ($null -eq $stage -and $current.Data.Contains('SolidWorksStage')) { $stage = $current.Data['SolidWorksStage'] }
        if ($attempts.Count -eq 0 -and $current.Data.Contains('SolidWorksAttachAttempts')) {
            $attempts = @($current.Data['SolidWorksAttachAttempts'])
        }
        $current = $current.InnerException
    }
    [pscustomobject]@{
        Code = $code
        Stage = $stage
        ExceptionChain = $chain
        RootCause = $chain[$chain.Count - 1]
        AttachAttempts = $attempts
    }
}

function Get-SolidWorksBridgeDefinition {
    # Pure source construction: also used by the offline managed-stub regressions.
    # Hash the template before substitution so any source change invalidates a
    # previously compiled bridge in the same PowerShell process.
    $template = @'
using System;
using System.Runtime.InteropServices;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;

namespace SolidWorksSkill {
    public sealed class DocumentIdentity {
        public string Title { get; set; }
        public string Path { get; set; }
        public int TypeCode { get; set; }
        public string Type { get; set; }
        public bool HasUnsavedChanges { get; set; }
    }
    public sealed class SessionMetadata {
        public int ProcessId { get; set; }
        public string Revision { get; set; }
        public string ExecutablePathReportedByApi { get; set; }
        public DocumentIdentity ActiveDocument { get; set; }
        public int DocumentCount { get; set; }
        public DocumentIdentity[] OpenDocuments { get; set; }
        public string SnapshotStartedAtUtc { get; set; }
        public string SnapshotFinishedAtUtc { get; set; }
        public string ConsistencyCheck { get; set; }
    }
    public static class ReadOnlySessionV2 {
        public const string SourceFingerprint = "__SOLIDWORKS_BRIDGE_SOURCE_HASH__";
        [DllImport("oleaut32.dll", PreserveSig = true)]
        private static extern int GetActiveObject(ref Guid clsid, IntPtr reserved,
            [MarshalAs(UnmanagedType.IUnknown)] out object instance);

        public static ISldWorks Attach(Guid clsid, int expectedProcessId) {
            object instance;
            Marshal.ThrowExceptionForHR(GetActiveObject(ref clsid, IntPtr.Zero, out instance));
            ISldWorks app = (ISldWorks)instance;
            if (app.GetProcessID() != expectedProcessId)
                throw new InvalidOperationException("Running COM object does not match the discovered SLDWORKS PID.");
            return app;
        }
        private static InvalidOperationException Unstable(string detail) {
            return new InvalidOperationException("SW_UNSTABLE_SNAPSHOT: " + detail + " Obtain a fresh observation before selecting a mutation target.");
        }
        private static bool SameDocument(IModelDoc2 left, IModelDoc2 right) {
            if (Object.ReferenceEquals(left, right)) return true;
            if (left == null || right == null) return false;
            // Distinct managed test objects are distinct identities even when
            // their paths are empty or equal. Real RCWs use COM IUnknown identity.
            if (!Marshal.IsComObject(left) || !Marshal.IsComObject(right)) return false;
            IntPtr leftIdentity = IntPtr.Zero;
            IntPtr rightIdentity = IntPtr.Zero;
            try {
                leftIdentity = Marshal.GetIUnknownForObject(left);
                rightIdentity = Marshal.GetIUnknownForObject(right);
                return leftIdentity == rightIdentity;
            } finally {
                if (rightIdentity != IntPtr.Zero) Marshal.Release(rightIdentity);
                if (leftIdentity != IntPtr.Zero) Marshal.Release(leftIdentity);
            }
        }
        private static int IndexOf(IModelDoc2[] documents, IModelDoc2 sought) {
            for (int i = 0; i < documents.Length; i++)
                if (SameDocument(documents[i], sought)) return i;
            return -1;
        }
        private static IModelDoc2[] ReadDocuments(ISldWorks app, int expectedCount) {
            if (expectedCount < 0)
                throw new InvalidOperationException("SW_DOCUMENT_RESPONSE: Negative document count.");
            object raw = app.GetDocuments();
            if (raw == null) {
                // Normalize a null array only when the independent count is zero.
                // A null element, or a null array with nonzero count, is an error.
                if (expectedCount != 0)
                    throw new InvalidOperationException("SW_DOCUMENT_RESPONSE: Null document array with a nonzero count.");
                return new IModelDoc2[0];
            }
            Array array = raw as Array;
            if (array == null || array.Rank != 1)
                throw new InvalidOperationException("SW_DOCUMENT_RESPONSE: Expected a one-dimensional document array.");
            if (array.Length != expectedCount)
                throw Unstable("Document-array length does not match the reported count.");
            IModelDoc2[] documents = new IModelDoc2[array.Length];
            int index = 0;
            foreach (object item in array) {
                if (item == null)
                    throw new InvalidOperationException("SW_DOCUMENT_RESPONSE: Null document entry at index " + index + ".");
                IModelDoc2 document = item as IModelDoc2;
                if (document == null)
                    throw new InvalidOperationException("SW_DOCUMENT_RESPONSE: Unsupported document entry at index " + index + ".");
                for (int previous = 0; previous < index; previous++)
                    if (SameDocument(documents[previous], document))
                        throw new InvalidOperationException("SW_DOCUMENT_RESPONSE: Duplicate document identity at index " + index + ".");
                documents[index++] = document;
            }
            return documents;
        }
        private static DocumentIdentity Identify(IModelDoc2 document) {
            if (document == null)
                throw new InvalidOperationException("SW_DOCUMENT_RESPONSE: Cannot identify a null document entry.");
            int typeCode = document.GetType();
            return new DocumentIdentity {
                Title = document.GetTitle(), Path = document.GetPathName(), TypeCode = typeCode,
                Type = ((swDocumentTypes_e)typeCode).ToString(),
                HasUnsavedChanges = document.GetSaveFlag()
            };
        }
        private static bool SameIdentity(DocumentIdentity first, DocumentIdentity second) {
            return String.Equals(first.Title, second.Title, StringComparison.Ordinal) &&
                String.Equals(first.Path, second.Path, StringComparison.Ordinal) &&
                first.TypeCode == second.TypeCode &&
                first.HasUnsavedChanges == second.HasUnsavedChanges;
        }
        // Keep the PowerShell boundary untyped; cast the RCW inside compiled C#.
        // Two matching observations detect common transitions, but are not an
        // atomic snapshot or a lock. Revalidate identity immediately before edits.
        public static SessionMetadata Inspect(object instance, int expectedProcessId) {
            ISldWorks app = (ISldWorks)instance;
            string started = DateTime.UtcNow.ToString("o");
            int processId = app.GetProcessID();
            if (processId != expectedProcessId)
                throw new InvalidOperationException("SOLIDWORKS process identity changed; reconnect before continuing.");
            string revision = app.RevisionNumber();
            string executablePath = app.GetExecutablePath();
            int countBefore = app.GetDocumentCount();
            IModelDoc2 activeBefore = app.IActiveDoc2;
            IModelDoc2[] before = ReadDocuments(app, countBefore);
            if (activeBefore != null && IndexOf(before, activeBefore) < 0)
                throw Unstable("Active document is absent from the document list.");
            DocumentIdentity[] identities = new DocumentIdentity[before.Length];
            for (int i = 0; i < before.Length; i++) identities[i] = Identify(before[i]);

            int countAfter = app.GetDocumentCount();
            IModelDoc2[] after = ReadDocuments(app, countAfter);
            if (countAfter != countBefore) throw Unstable("Document count changed.");
            for (int i = 0; i < before.Length; i++) {
                int afterIndex = IndexOf(after, before[i]);
                if (afterIndex < 0) throw Unstable("Document identities changed while the count remained constant.");
                if (!SameIdentity(identities[i], Identify(after[afterIndex])))
                    throw Unstable("Document path, title, type or unsaved state changed.");
            }
            IModelDoc2 activeAfter = app.IActiveDoc2;
            if (!SameDocument(activeBefore, activeAfter)) throw Unstable("Active document changed.");
            if (activeAfter != null && IndexOf(after, activeAfter) < 0)
                throw Unstable("Active document is absent from the second document list.");
            if (app.GetDocumentCount() != countAfter) throw Unstable("Document count changed after enumeration.");
            if (app.GetProcessID() != processId)
                throw new InvalidOperationException("SOLIDWORKS process identity changed during metadata observation.");
            return new SessionMetadata {
                ProcessId = processId, Revision = revision, ExecutablePathReportedByApi = executablePath,
                ActiveDocument = activeBefore == null ? null : identities[IndexOf(before, activeBefore)],
                DocumentCount = countBefore, OpenDocuments = identities,
                SnapshotStartedAtUtc = started, SnapshotFinishedAtUtc = DateTime.UtcNow.ToString("o"),
                ConsistencyCheck = "Two document-identity and active-document observations matched; non-atomic, not an ownership lock."
            };
        }
    }
}
'@
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $hashBytes = $hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($template)) }
    finally { $hasher.Dispose() }
    $fingerprint = ([BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()
    [pscustomobject]@{
        TypeName = 'SolidWorksSkill.ReadOnlySessionV2'
        SourceFingerprint = $fingerprint
        CompiledSource = $template.Replace('__SOLIDWORKS_BRIDGE_SOURCE_HASH__', $fingerprint)
    }
}

function Assert-SolidWorksBridgeCompatibility {
    param([Parameter(Mandatory = $true)] $Definition)
    if ('SolidWorksSkill.ReadOnlySessionV1' -as [type]) {
        throw 'SW_BRIDGE_CONFLICT: An older ReadOnlySessionV1 bridge is loaded. Use a fresh Windows PowerShell process after a helper update.'
    }
    $loadedBridge = $Definition.TypeName -as [type]
    if ($null -ne $loadedBridge) {
        $field = $loadedBridge.GetField('SourceFingerprint')
        if ($null -eq $field -or -not [string]::Equals([string]$field.GetValue($null), $Definition.SourceFingerprint, [StringComparison]::Ordinal)) {
            throw 'SW_BRIDGE_CONFLICT: The loaded bridge does not match this helper source. Use a fresh Windows PowerShell process.'
        }
    }
}

function Connect-SolidWorks {
    [CmdletBinding()]
    param(
        # Optional assertion of the installation directory containing SLDWORKS.exe.
        # The running process remains the source of truth; this cannot select a
        # process when several SOLIDWORKS instances are running.
        [string] $InstallRoot
    )

    if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion -lt [version]'5.1' -or
        -not [Environment]::Is64BitProcess -or
        [Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
        throw 'SW_RUNTIME: Use 64-bit Windows PowerShell 5.1 with -NoProfile -STA. This helper does not support PowerShell 7, 32-bit PowerShell, or MTA.'
    }

    $bridgeDefinition = Get-SolidWorksBridgeDefinition
    Assert-SolidWorksBridgeCompatibility -Definition $bridgeDefinition

    $running = @(Get-Process -Name SLDWORKS -ErrorAction SilentlyContinue)
    if ($running.Count -eq 0) {
        throw 'SW_NOT_RUNNING: No running SLDWORKS process was found. This helper does not launch applications.'
    }
    if ($running.Count -ne 1) {
        throw ('SW_AMBIGUOUS: Expected one running SLDWORKS process; found {0} (PIDs: {1}). Resolve the intended session before using this helper.' -f $running.Count, (($running | ForEach-Object { $_.Id }) -join ', '))
    }
    $process = $running[0]
    try { $executable = $process.Path } catch { $executable = $null }
    if ([string]::IsNullOrWhiteSpace($executable)) {
        throw 'SW_PROCESS_PATH: Cannot read the running executable path. Run in the same Windows user/session and integrity level as SOLIDWORKS.'
    }
    $root = [IO.Path]::GetDirectoryName($executable)
    if ($PSBoundParameters.ContainsKey('InstallRoot')) {
        if ([string]::IsNullOrWhiteSpace($InstallRoot) -or -not (Test-Path -LiteralPath $InstallRoot -PathType Container)) {
            throw 'SW_INVALID_INSTALL: InstallRoot must be an existing directory containing the running SLDWORKS.exe.'
        }
        $assertedRoot = (Get-Item -LiteralPath $InstallRoot -ErrorAction Stop).FullName.TrimEnd('\')
        if (-not [string]::Equals($assertedRoot, $root.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
            throw ('SW_INVALID_INSTALL: InstallRoot does not match the running installation: {0}' -f $root)
        }
    }
    $interop = Join-Path $root 'api\redist\SolidWorks.Interop.sldworks.dll'
    $constants = Join-Path $root 'api\redist\SolidWorks.Interop.swconst.dll'
    foreach ($required in @($executable, $interop, $constants)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw ('SW_INVALID_INSTALL: Required installation file is missing: {0}' -f $required)
        }
    }
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($executable)
    foreach ($assemblyPath in @($interop, $constants)) {
        try { $assemblyName = [Reflection.AssemblyName]::GetAssemblyName($assemblyPath) }
        catch { throw (New-SolidWorksContextException -Code 'SW_INTEROP' -Stage 'ReadInteropAssembly' -Message ('Cannot read installation interop assembly {0}' -f $assemblyPath) -InnerException $_.Exception) }
        if ($assemblyName.Version.Major -ne $version.FileMajorPart) {
            throw ('SW_INTEROP: Interop major version does not match the running executable: {0}' -f $assemblyPath)
        }
        $loaded = @([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $_.GetName().Name -eq $assemblyName.Name })
        foreach ($item in $loaded) {
            if (-not [string]::Equals($item.Location, $assemblyPath, [StringComparison]::OrdinalIgnoreCase)) {
                throw ('SW_INTEROP_CONFLICT: {0} is already loaded from another location. Use a fresh Windows PowerShell process.' -f $assemblyName.Name)
            }
        }
        try { Add-Type -Path $assemblyPath -ErrorAction Stop }
        catch { throw (New-SolidWorksContextException -Code 'SW_INTEROP' -Stage 'LoadInteropAssembly' -Message ('Could not load {0}' -f $assemblyPath) -InnerException $_.Exception) }
    }

    if (-not ($bridgeDefinition.TypeName -as [type])) {
        try {
            Add-Type -ReferencedAssemblies @($interop, $constants) -ErrorAction Stop -TypeDefinition $bridgeDefinition.CompiledSource
        } catch {
            throw (New-SolidWorksContextException -Code 'SW_INTEROP_RUNTIME' -Stage 'CompileBridge' -Message 'Typed bridge compilation failed. Use a fresh 64-bit Windows PowerShell 5.1 process and the running installation interop.' -InnerException $_.Exception)
        }
    }

    # Read registered CLSIDs without CLSIDFromProgID, which can create a registry
    # entry for an unknown ProgID. GetActiveObject only retrieves an existing object.
    $application = $null
    $selectedProgId = $null
    $failures = @()
    $lastAttachException = $null
    foreach ($progId in @(('SldWorks.Application.' + $version.FileMajorPart), 'SldWorks.Application')) {
        $key = $null
        $attachStage = 'RegistryLookup'
        try {
            $key = [Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey($progId + '\CLSID', $false)
            if ($null -eq $key) { throw 'ProgID is not registered.' }
            $attachStage = 'ReadClsid'
            $clsid = [Guid]$key.GetValue('')
            $attachStage = 'AttachRunningObject'
            $application = [SolidWorksSkill.ReadOnlySessionV2]::Attach($clsid, $process.Id)
            $selectedProgId = $progId
            break
        } catch {
            $lastAttachException = $_.Exception
            $failures += [pscustomobject]@{ProgId=$progId; Stage=$attachStage; ErrorDetails=(ConvertTo-SolidWorksErrorInfo -Exception $_.Exception)}
        } finally {
            if ($null -ne $key) { $key.Dispose() }
        }
    }
    if ($null -eq $application) {
        throw (New-SolidWorksContextException -Code 'SW_ATTACH' -Stage 'AttachRunningObject' -Message 'Could not attach to the discovered running process. Ensure SOLIDWORKS has finished starting and use the same Windows user/session and integrity level. No application was launched.' -InnerException $lastAttachException -AttachAttempts $failures)
    }

    $apiRoot = Join-Path $root 'api'
    $helpPaths = @(Get-ChildItem -LiteralPath $apiRoot -Filter '*.chm' -File -ErrorAction Stop | Sort-Object Name | ForEach-Object { $_.FullName })
    $interopPaths = @(Get-ChildItem -LiteralPath (Join-Path $apiRoot 'redist') -Filter 'SolidWorks.Interop.*.dll' -File -ErrorAction Stop | Sort-Object Name | ForEach-Object { $_.FullName })
    [pscustomobject]@{
        Application = $application
        BridgeSourceFingerprint = $bridgeDefinition.SourceFingerprint
        AttachAttempts = $failures
        ProcessId = $process.Id
        ProcessStartTimeUtc = $process.StartTime.ToUniversalTime().ToString('o')
        InstallRoot = $root
        Executable = $executable
        ProductName = $version.ProductName
        ExecutableVersion = $version.FileVersion
        ProgId = $selectedProgId
        InteropPath = $interop
        ConstantsPath = $constants
        DiscoveredInteropPaths = $interopPaths
        ApiHelpPaths = $helpPaths
    }
}

function Get-SolidWorksSessionInfo {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] $Connection)

    $bridgeDefinition = Get-SolidWorksBridgeDefinition
    Assert-SolidWorksBridgeCompatibility -Definition $bridgeDefinition
    if ($Connection.BridgeSourceFingerprint -and $Connection.BridgeSourceFingerprint -ne $bridgeDefinition.SourceFingerprint) {
        throw 'SW_BRIDGE_CONFLICT: Connection was created by different helper source; reconnect in a fresh Windows PowerShell process.'
    }
    try { $metadata = [SolidWorksSkill.ReadOnlySessionV2]::Inspect($Connection.Application, $Connection.ProcessId) }
    catch { throw (New-SolidWorksContextException -Code 'SW_METADATA' -Stage 'InspectMetadata' -Message ('Read-only metadata probe failed: {0}' -f $_.Exception.GetBaseException().Message) -InnerException $_.Exception) }
    [pscustomobject]@{
        SchemaVersion = 2
        BridgeSourceFingerprint = $bridgeDefinition.SourceFingerprint
        AttachAttempts = @($Connection.AttachAttempts)
        SnapshotStartedAtUtc = $metadata.SnapshotStartedAtUtc
        SnapshotFinishedAtUtc = $metadata.SnapshotFinishedAtUtc
        ConsistencyCheck = $metadata.ConsistencyCheck
        ObservedAtUtc = [DateTime]::UtcNow.ToString('o')
        ProcessId = $metadata.ProcessId
        ProcessStartTimeUtc = $Connection.ProcessStartTimeUtc
        ProductName = $Connection.ProductName
        Revision = $metadata.Revision
        ExecutableVersion = $Connection.ExecutableVersion
        Executable = $Connection.Executable
        ExecutablePathReportedByApi = $metadata.ExecutablePathReportedByApi
        InstallRoot = $Connection.InstallRoot
        ProgId = $Connection.ProgId
        InteropPath = $Connection.InteropPath
        ConstantsPath = $Connection.ConstantsPath
        DiscoveredInteropPaths = @($Connection.DiscoveredInteropPaths)
        ApiHelpPaths = @($Connection.ApiHelpPaths)
        ActiveDocument = $metadata.ActiveDocument
        DocumentCount = $metadata.DocumentCount
        OpenDocuments = @($metadata.OpenDocuments)
    }
}
