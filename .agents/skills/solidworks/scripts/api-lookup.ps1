<#
.SYNOPSIS
Offline SOLIDWORKS API signature and enum lookup from the installed interop assemblies.
.DESCRIPTION
Reads SolidWorks.Interop.sldworks.dll and swconst.dll by reflection. It does not attach to or
start SOLIDWORKS, and works in any agent harness, unlike the .chm help. Examples:
  powershell.exe -NoProfile -File <skill>/scripts/api-lookup.ps1 -Type IFeatureManager -Member FeatureExtrusion3
  powershell.exe -NoProfile -File <skill>/scripts/api-lookup.ps1 -Type IModelDocExtension -Member SaveAs
  powershell.exe -NoProfile -File <skill>/scripts/api-lookup.ps1 -Enum swEndConditions_e
  powershell.exe -NoProfile -File <skill>/scripts/api-lookup.ps1 -Search Rollback
-Type/-Member print every overload with parameter names, types, ref/out and the return type
(-Member matches by prefix, case-insensitive). -Enum prints names and values. -Search lists
interfaces, members and enums whose name contains the text. The installed help text is not
included: read the official page for remarks and examples when behaviour matters.
#>
[CmdletBinding()]
param(
    [string] $Type,
    [string] $Member,
    [string] $Enum,
    [string] $Search,
    [string] $InstallRoot,
    [int] $Limit = 60
)
$ErrorActionPreference = 'Stop'

function Resolve-InstallRoot {
    if ($InstallRoot) { return (Get-Item -LiteralPath $InstallRoot).FullName }
    $running = @(Get-Process -Name SLDWORKS -ErrorAction SilentlyContinue)
    if ($running.Count -ge 1) { try { if ($running[0].Path) { return [IO.Path]::GetDirectoryName($running[0].Path) } } catch { } }
    foreach ($key in @('HKLM:\SOFTWARE\SolidWorks\SOLIDWORKS 2026\Setup', 'HKLM:\SOFTWARE\SolidWorks\SOLIDWORKS 2025\Setup', 'HKLM:\SOFTWARE\SolidWorks\SOLIDWORKS 2024\Setup')) {
        $item = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
        if ($item -and ($item.PSObject.Properties.Name -contains 'SolidWorks Folder')) { return $item.'SolidWorks Folder'.TrimEnd('\') }
    }
    return 'C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS'
}

function Format-Type([Type] $t) {
    if ($t.IsByRef) { return 'ref ' + (Format-Type $t.GetElementType()) }
    if ($t.IsArray) { return (Format-Type $t.GetElementType()) + '[]' }
    $map = @{ 'System.Object' = 'object'; 'System.String' = 'string'; 'System.Int32' = 'int'; 'System.Double' = 'double'; 'System.Boolean' = 'bool'; 'System.Void' = 'void'; 'System.Int16' = 'short'; 'System.Int64' = 'long' }
    if ($map.ContainsKey($t.FullName)) { return $map[$t.FullName] }
    return $t.Name
}

$root = Resolve-InstallRoot
$sldworks = [Reflection.Assembly]::LoadFrom((Join-Path $root 'api\redist\SolidWorks.Interop.sldworks.dll'))
$swconst = [Reflection.Assembly]::LoadFrom((Join-Path $root 'api\redist\SolidWorks.Interop.swconst.dll'))
$types = @($sldworks.GetExportedTypes()) + @($swconst.GetExportedTypes())
$out = New-Object System.Collections.Generic.List[string]

if ($Enum) {
    $e = $types | Where-Object { $_.IsEnum -and $_.Name -ieq $Enum } | Select-Object -First 1
    if (-not $e) { throw "Enum not found: $Enum (try -Search)" }
    foreach ($n in [Enum]::GetNames($e)) { $out.Add(('{0} = {1}' -f $n, [Convert]::ToInt64([Enum]::Parse($e, $n)))) }
} elseif ($Type) {
    $t = $types | Where-Object { $_.Name -ieq $Type } | Select-Object -First 1
    if (-not $t) { throw "Type not found: $Type (try -Search)" }
    $members = @($t.GetMethods()) + @($t.GetInterfaces() | ForEach-Object { $_.GetMethods() })
    $props = @($t.GetProperties()) + @($t.GetInterfaces() | ForEach-Object { $_.GetProperties() })
    foreach ($p in $props | Sort-Object Name -Unique) {
        if ($Member -and -not $p.Name.StartsWith($Member, [StringComparison]::OrdinalIgnoreCase)) { continue }
        $access = @(); if ($p.CanRead) { $access += 'get' }; if ($p.CanWrite) { $access += 'set' }
        $idx = @($p.GetIndexParameters() | ForEach-Object { (Format-Type $_.ParameterType) + ' ' + $_.Name })
        $out.Add(('property {0} {1}{2} {{ {3} }}' -f (Format-Type $p.PropertyType), $p.Name, $(if ($idx.Count) { '[' + ($idx -join ', ') + ']' } else { '' }), ($access -join '; ')))
    }
    foreach ($m in $members | Where-Object { -not $_.IsSpecialName } | Sort-Object Name) {
        if ($Member -and -not $m.Name.StartsWith($Member, [StringComparison]::OrdinalIgnoreCase)) { continue }
        $ps = @($m.GetParameters() | ForEach-Object {
            $kind = if ($_.IsOut) { 'out ' } elseif ($_.ParameterType.IsByRef) { 'ref ' } else { '' }
            $pt = if ($_.ParameterType.IsByRef) { $_.ParameterType.GetElementType() } else { $_.ParameterType }
            $kind + (Format-Type $pt) + ' ' + $_.Name
        })
        $line = '{0} {1}({2})' -f (Format-Type $m.ReturnType), $m.Name, ($ps -join ', ')
        if (-not $out.Contains($line)) { $out.Add($line) }
    }
    if ($out.Count -eq 0) { throw "No member of $($t.Name) starts with '$Member'" }
} elseif ($Search) {
    foreach ($t in $types) {
        if ($t.Name.IndexOf($Search, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $out.Add(('{0} {1}' -f $(if ($t.IsEnum) { 'enum' } else { 'type' }), $t.Name)) }
        if ($t.IsEnum) {
            foreach ($n in [Enum]::GetNames($t)) { if ($n.IndexOf($Search, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $out.Add(('enum value {0}.{1}' -f $t.Name, $n)) } }
        } elseif ($t.Name.StartsWith('I')) {
            foreach ($m in $t.GetMembers()) { if ($m.Name.IndexOf($Search, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $out.Add(('member {0}.{1}' -f $t.Name, $m.Name)) } }
        }
        if ($out.Count -ge $Limit) { break }
    }
} else {
    throw 'Give -Type [-Member], -Enum or -Search.'
}
$out | Select-Object -Unique | Select-Object -First $Limit
