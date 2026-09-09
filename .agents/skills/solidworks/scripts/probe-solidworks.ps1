<#
.SYNOPSIS
Prints JSON metadata from an already running desktop SOLIDWORKS session.
.DESCRIPTION
Run with 64-bit Windows PowerShell 5.1: powershell.exe -NoProfile -STA -File <script>
No application is launched and no document, preference, or security setting is
changed. JSON goes to stdout. On failure, JSON with Error and structured ErrorDetails fields is printed and
the process exits with code 1. No files are written unless the caller redirects.
#>
[CmdletBinding()]
param([string] $InstallRoot)

$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'connect-solidworks.ps1')
    $connectionArguments = @{}
    if ($PSBoundParameters.ContainsKey('InstallRoot')) { $connectionArguments.InstallRoot = $InstallRoot }
    $connection = Connect-SolidWorks @connectionArguments
    Get-SolidWorksSessionInfo -Connection $connection | ConvertTo-Json -Depth 16
    exit 0
} catch {
    [pscustomobject]@{
        SchemaVersion = 2
        ObservedAtUtc = [DateTime]::UtcNow.ToString('o')
        Error = $_.Exception.Message
        ErrorDetails = if (Get-Command ConvertTo-SolidWorksErrorInfo -CommandType Function -ErrorAction SilentlyContinue) {
            ConvertTo-SolidWorksErrorInfo -Exception $_.Exception
        } else {
            [pscustomobject]@{ExceptionType=$_.Exception.GetType().FullName; HResult=$_.Exception.HResult; HResultHex=('0x{0:X8}' -f $_.Exception.HResult); Message=$_.Exception.Message}
        }
    } | ConvertTo-Json -Depth 16
    exit 1
}
