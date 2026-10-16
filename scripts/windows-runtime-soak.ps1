param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
    [ValidateRange(1, 10000)][int]$Cycles = 100,
    [ValidateRange(100, 30000)][int]$DwellMilliseconds = 1000,
    [string]$LogPath = (Join-Path (Get-Location) ("windows-soak-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.csv'))
)
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows-only acceptance helper.' }
$process = Get-Process -Id $ProcessId -ErrorAction Stop
$exe = $process.MainModule.FileName
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash -ne $ExpectedSha256) {
    throw 'Selected process EXE does not match the retained candidate SHA256.'
}
$process.Refresh()
$window = $process.MainWindowHandle
if ($window -eq [IntPtr]::Zero) { throw 'Selected candidate has no main window.' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RvhSoakWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
}
'@
function Write-SoakLog([int]$Cycle, [string]$Event) {
    [PSCustomObject]@{
        TimestampUtc = [DateTime]::UtcNow.ToString('o'); ProcessId = $ProcessId
        ExeSha256 = $ExpectedSha256.ToLowerInvariant(); Cycle = $Cycle; Event = $Event
    } | Export-Csv -LiteralPath $LogPath -Append -NoTypeInformation -Encoding utf8
}
function Assert-CandidateAlive {
    $process.Refresh()
    if ($process.HasExited) {
        Write-SoakLog $cycle ("PROCESS_EXIT_0x" + $process.ExitCode.ToString('X8'))
        throw 'Candidate exited during soak. Preserve this log, matching symbols and a crash dump.'
    }
    if (-not [RvhSoakWindow]::IsWindow($window)) {
        Write-SoakLog $cycle 'WINDOW_DESTROYED'
        throw 'Candidate window was destroyed; soak did not complete.'
    }
}
Write-SoakLog 0 'START'
for ($cycle = 1; $cycle -le $Cycles; $cycle++) {
    Assert-CandidateAlive
    if (-not [RvhSoakWindow]::ShowWindowAsync($window, 6)) { throw 'Minimize request failed.' }
    Write-SoakLog $cycle 'MINIMIZE'
    Start-Sleep -Milliseconds $DwellMilliseconds
    Assert-CandidateAlive
    if (-not [RvhSoakWindow]::ShowWindowAsync($window, 9)) { throw 'Restore request failed.' }
    Write-SoakLog $cycle 'RESTORE'
    Start-Sleep -Milliseconds $DwellMilliseconds
}
Assert-CandidateAlive
Write-SoakLog $Cycles 'COMPLETED_WINDOW_CYCLES_ONLY'
Write-Host "Completed $Cycles window cycles. This does not by itself accept IPC, Reveal, Stop or overall crash repair. Log: $LogPath"
