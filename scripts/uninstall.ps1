<#
.SYNOPSIS
    Removes MetaTrader 5 Modern Style from every MetaTrader 5 on this PC.

.DESCRIPTION
    Run it with uninstall.bat (double-click). For each MetaTrader 5 data folder of this Windows user
    it deletes MQL5\Experts\ActionInna, MQL5\Include\ActionInna, MQL5\Scripts\ActionInna,
    MQL5\Include\ModernScreen and MQL5\Services\ModernScreen. It also closes the Modern Screen,
    stops it starting with Windows and deletes its program (%LOCALAPPDATA%\ModernScreen). It asks
    first. Remove the EA from your charts before you run it (or close MetaTrader 5).

    Kept: your panel settings and SL/TP history in the Common files folder (Common\Files\ActionInna),
    the log in MQL5\Files\ActionInna, the "ModernStyle" chart template, and the screen's drawings and
    templates in %APPDATA%\ModernScreen. Delete those by hand if you want them gone too.

.PARAMETER Yes
    Do not ask.
#>
[CmdletBinding()]
param([switch]$Yes)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$Parts = @('Experts\ActionInna', 'Include\ActionInna', 'Scripts\ActionInna', 'Include\ModernScreen', 'Services\ModernScreen')

$ScreenApp = Join-Path $env:LOCALAPPDATA 'ModernScreen'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

$terminals = @(Get-Terminals)
$found = @()
foreach ($t in $terminals) {
    foreach ($part in $Parts) {
        $path = Join-Path $t.DataFolder "MQL5\$part"
        if (Test-Path -LiteralPath $path) { $found += $path }
    }
}
if (Test-Path -LiteralPath $ScreenApp) { $found += $ScreenApp }
if ($found.Count -eq 0) {
    Write-Host 'MetaTrader 5 Modern Style is not installed in any MetaTrader 5 of this Windows user.'
    exit 0
}

Write-Host 'These folders will be deleted:'
$found | ForEach-Object { Write-Host "  $_" }
if (-not $Yes) {
    $answer = Read-Host 'Type Y and press Enter to delete them'
    if ($answer -ne 'Y' -and $answer -ne 'y') {
        Write-Host 'Nothing was deleted.'
        exit 0
    }
}
Get-Process -Name ModernScreen -ErrorAction SilentlyContinue | Stop-Process -Force
if (Get-ItemProperty -Path $RunKey -Name ModernScreen -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $RunKey -Name ModernScreen
    Write-Host '  the Modern Screen no longer starts with Windows'
}
Start-Sleep -Milliseconds 500
foreach ($path in $found) {
    if (Test-Junction $path) {
        # A developer link (scripts\link-mt5.ps1): only the link goes, never the files it points to.
        Remove-Junction $path
    }
    else {
        Remove-Item -LiteralPath $path -Recurse -Force
    }
    Write-Host "  deleted $path"
}
Write-Host 'Done. Restart MetaTrader 5 so its Navigator no longer lists the programs.' -ForegroundColor Green
