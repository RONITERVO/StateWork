<#
.SYNOPSIS
Read-only list of the visible top-level windows and dialogs of the running SOLIDWORKS process.
.DESCRIPTION
Use when a job stops returning, to see whether a modal window (Modify dimension box, rebuild
error, save prompt, licence message) is holding the API call. It enumerates windows with the
Win32 API only: no COM attach, no input, no focus change, so it is safe while a call is blocked.
  powershell.exe -NoProfile -File <skill>/scripts/list-dialogs.ps1
Prints JSON: one entry per visible window of SLDWORKS.exe with handle, class, title, whether it
is a standard dialog (#32770), and the text of its child controls (button captions, labels).
Dismissing a dialog is a deliberate UI action: decide from its text, then use the computer-use
skill (or Escape) as described in references/verification-recovery.md.
#>
[CmdletBinding()]
param([int] $ProcessId)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class SwDialogList
{
    delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
    public static List<string[]> Windows(uint pid)
    {
        List<string[]> found = new List<string[]>();
        EnumWindows(delegate (IntPtr h, IntPtr l) {
            uint p; GetWindowThreadProcessId(h, out p);
            if (p == pid && IsWindowVisible(h)) found.Add(new string[] { h.ToInt64().ToString(), Cls(h), Txt(h) });
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static List<string> Children(long handle)
    {
        List<string> texts = new List<string>();
        EnumChildWindows(new IntPtr(handle), delegate (IntPtr h, IntPtr l) {
            string t = Txt(h);
            if (IsWindowVisible(h) && t.Length > 0) texts.Add(Cls(h) + ": " + t);
            return true;
        }, IntPtr.Zero);
        return texts;
    }
    static string Txt(IntPtr h) { StringBuilder s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
    static string Cls(IntPtr h) { StringBuilder s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
}
'@

$procs = if ($ProcessId) { @(Get-Process -Id $ProcessId) } else { @(Get-Process -Name SLDWORKS -ErrorAction SilentlyContinue) }
if ($procs.Count -eq 0) { [pscustomobject]@{ Ok = $false; Error = 'SLDWORKS.exe is not running' } | ConvertTo-Json; exit 1 }
$result = foreach ($p in $procs) {
    foreach ($w in [SwDialogList]::Windows([uint32]$p.Id)) {
        [pscustomobject]@{
            ProcessId = $p.Id
            Handle = [long]$w[0]
            Class = $w[1]
            Title = $w[2]
            IsDialog = ($w[1] -eq '#32770')
            Controls = @([SwDialogList]::Children([long]$w[0]) | Select-Object -First 40)
        }
    }
}
[pscustomobject]@{ Ok = $true; ObservedAtUtc = [DateTime]::UtcNow.ToString('o'); Windows = @($result) } | ConvertTo-Json -Depth 6
