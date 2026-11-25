<#
.SYNOPSIS
    Writes references/swkit-api.md: every public SwKit member with its signature and the start of its /// summary,
    grouped by the section comments of scripts/lib/SwKit.cs.

.DESCRIPTION
    The index is generated so that it cannot lag behind the kit. Run it after changing SwKit.cs; -Check only compares
    and exits 1 when the committed index is stale (the offline suite runs it). Offline, no SOLIDWORKS needed.

.EXAMPLE
    powershell.exe -NoProfile -File scripts/kit-index.ps1
    powershell.exe -NoProfile -File scripts/kit-index.ps1 -Check
#>
[CmdletBinding()]
param(
    [string] $KitPath = '',
    [string] $OutPath = '',
    [int] $SummaryChars = 260,
    [switch] $Check
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path   # $PSScriptRoot is empty in Windows PowerShell 5.1 param defaults
if (-not $KitPath) { $KitPath = Join-Path $scriptDir 'lib\SwKit.cs' }
if (-not $OutPath) { $OutPath = Join-Path (Split-Path $scriptDir -Parent) 'references\swkit-api.md' }

function Get-CountOf([string] $Text, [char] $Character) {
    return ($Text.ToCharArray() | Where-Object { $_ -eq $Character }).Count
}

function Convert-Summary([string[]] $DocLines, [int] $Limit) {
    $text = ($DocLines -join ' ')
    $text = $text -replace '<param name="(\w+)">', '$1: '
    $text = $text -replace '<see cref="([^"]+)"\s*/>', '$1'
    $text = $text -replace '</?(summary|param|returns|remarks|c|para)[^>]*>', ' '
    $text = ($text -replace '\s+', ' ').Trim()
    $text = $text -replace ' \* ', ' \* '
    if ($text.Length -le $Limit) { return $text }
    $cut = $text.Substring(0, $Limit)
    $stop = $cut.LastIndexOf('. ')
    if ($stop -gt 80) { return $cut.Substring(0, $stop + 1) }
    return $cut.TrimEnd() + ' ...'
}

$lines = [IO.File]::ReadAllLines($KitPath)
$sections = New-Object 'System.Collections.Specialized.OrderedDictionary'
$section = 'General'
$class = ''
$doc = New-Object 'System.Collections.Generic.List[string]'

for ($i = 0; $i -lt $lines.Length; $i++) {
    $t = $lines[$i].Trim()
    if ($t -match '^(public|internal)\s+((sealed|static|abstract)\s+)*class\s+(\w+)') {
        $class = $Matches[4]
        if ($class -ne 'Cad') { $section = $class } else { $section = 'Session and logging' }
        $doc.Clear()
        continue
    }
    if ($t -match '^//\s*-{5,}\s*(.+)$') {
        $section = $Matches[1].Trim()
        $doc.Clear()
        continue
    }
    if ($t.StartsWith('///')) {
        $doc.Add($t.Substring(3).Trim())
        continue
    }
    if ($t.StartsWith('[')) { continue }   # attributes keep the summary above them
    if ($t -match '^public\s' -and $class -ne '') {
        $signature = $t
        $j = $i
        while ((Get-CountOf $signature '(') -gt (Get-CountOf $signature ')') -and $j + 1 -lt $lines.Length) {
            $j++
            $signature += ' ' + $lines[$j].Trim()
        }
        $signature = $signature -replace '\s*\{.*$', ''
        $signature = $signature -replace '\s*=>.*$', ''
        if ($signature -notmatch '\(') { $signature = $signature -replace '\s*=\s.*$', '' }
        $signature = $signature -replace ';\s*$', ''
        $signature = $signature -replace '^public\s+', ''
        $signature = $signature -replace '\b(static|readonly|override|virtual|sealed)\s+', ''
        $signature = ($signature -replace '\s+', ' ').Trim()
        if ($class -ne 'Cad') { $signature = $class + ': ' + $signature }
        $summary = Convert-Summary $doc.ToArray() $SummaryChars
        if (-not $sections.Contains($section)) { $sections[$section] = New-Object 'System.Collections.Generic.List[string]' }
        $entry = '- `' + $signature + '`'
        if ($summary) { $entry += ' - ' + $summary }
        $sections[$section].Add($entry)
        $doc.Clear()
        $i = $j
        continue
    }
    if ($t -ne '') { $doc.Clear() }
}

$out = New-Object 'System.Collections.Generic.List[string]'
$total = 0
foreach ($key in $sections.Keys) { $total += $sections[$key].Count }
$out.Add('# SwKit API index (generated)')
$out.Add('')
$out.Add('Generated from `scripts/lib/SwKit.cs` by `scripts/kit-index.ps1`; do not edit by hand. Regenerate after changing the kit')
$out.Add('(`powershell.exe -NoProfile -File scripts/kit-index.ps1`); `-Check` exits 1 when this file is stale and the offline suite')
$out.Add('runs it. Lengths are millimetres and angles degrees unless a name says otherwise. Search this file for a verb (Extrude,')
$out.Add('Section, Mate, Bom ...) before writing raw API, then read the full `///` summary in SwKit.cs. ' + $total + ' members.')
foreach ($key in $sections.Keys) {
    $out.Add('')
    $out.Add('## ' + $key.Substring(0, 1).ToUpper() + $key.Substring(1))
    $out.Add('')
    foreach ($entry in $sections[$key]) { $out.Add($entry) }
}
$text = ($out -join "`n") + "`n"

if ($Check) {
    $current = if (Test-Path $OutPath) { ([IO.File]::ReadAllText($OutPath)) -replace "`r`n", "`n" } else { '' }
    if ($current -ne $text) {
        Write-Output ('STALE: ' + $OutPath + ' does not match SwKit.cs; run scripts/kit-index.ps1')
        exit 1
    }
    Write-Output ('OK: ' + $OutPath + ' is current (' + $total + ' members)')
    exit 0
}

[IO.File]::WriteAllText($OutPath, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ('Wrote ' + $OutPath + ' (' + $total + ' members in ' + $sections.Count + ' sections)')
