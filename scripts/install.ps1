<#
.SYNOPSIS
    Installs MetaTrader 5 Modern Style into every MetaTrader 5 on this PC and compiles it.

.DESCRIPTION
    Run it with install.bat (double-click). It needs MetaTrader 5 for Windows, opened at least once.

    For each MetaTrader 5 data folder of this Windows user it copies, from this folder:
        mql5\Experts\ActionInna   ->  <data folder>\MQL5\Experts\ActionInna
        mql5\Include\ActionInna   ->  <data folder>\MQL5\Include\ActionInna
        mql5\Scripts\ActionInna   ->  <data folder>\MQL5\Scripts\ActionInna
        mql5\Include\ModernScreen ->  <data folder>\MQL5\Include\ModernScreen
        mql5\Services\ModernScreen -> <data folder>\MQL5\Services\ModernScreen
    then compiles the ActionInna order ticket, the ModernStyle script and the ModernScreen service
    with that terminal's own MetaEditor.

    Then it builds the Modern Screen program (ModernScreen.exe) into %LOCALAPPDATA%\ModernScreen\app
    with the C# compiler that comes with Windows, asks whether it should start with Windows (so the
    screen opens with MetaTrader 5), and starts it. Running it again updates everything.

.PARAMETER StartWithWindows
    Start the Modern Screen with Windows without asking.

.PARAMETER NoScreen
    Install the MetaTrader 5 programs only, not the Modern Screen.

.PARAMETER NoCompile
    Copy the files only. Compile them in MetaEditor yourself (F4 in MetaTrader 5, then F7).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#>
[CmdletBinding()]
param([switch]$NoCompile, [switch]$StartWithWindows, [switch]$NoScreen)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$Repo = Split-Path -Parent $PSScriptRoot
$Parts = @('Experts\ActionInna', 'Include\ActionInna', 'Scripts\ActionInna', 'Include\ModernScreen', 'Services\ModernScreen')
$Programs = @('Experts\ActionInna\ActionInna.mq5', 'Scripts\ActionInna\ModernStyle.mq5', 'Services\ModernScreen\ModernScreen.mq5')

function Say([string]$Text, [string]$Color = 'Gray') { Write-Host $Text -ForegroundColor $Color }

function Compile([string]$Editor, [string]$Mql5, [string]$Rel) {
    $src = Join-Path $Mql5 $Rel
    $log = [IO.Path]::ChangeExtension($src, '.log')
    if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force }
    $arguments = '/compile:"' + $src + '" /include:"' + $Mql5 + '" /log'
    Start-Process -FilePath $Editor -ArgumentList $arguments -Wait -WindowStyle Hidden | Out-Null
    if (-not (Test-Path -LiteralPath $log)) { return 'MetaEditor wrote no log' }
    # MetaEditor's exit code is not reliable: the result is read from its log.
    $result = (Read-TextAuto $log) -split "`r?`n" | Where-Object { $_ -match 'Result:' } | Select-Object -Last 1
    if ($result -match '(\d+)\s+error' -and [int]$Matches[1] -eq 0) { return '' }
    if ($result) { return $result.Trim() }
    return 'no result in the log'
}

foreach ($part in $Parts) {
    if (-not (Test-Path -LiteralPath (Join-Path $Repo "mql5\$part"))) {
        throw "mql5\$part is missing. Run install.bat from the folder you unzipped, with all its files."
    }
}

Say ''
Say 'MetaTrader 5 Modern Style - install' 'Cyan'
Say ''

$terminals = @(Get-Terminals)
if ($terminals.Count -eq 0) {
    Say 'No MetaTrader 5 was found for this Windows user.' 'Yellow'
    Say 'Install MetaTrader 5, open it once (so it creates its data folder), close it and run install.bat again.'
    exit 1
}

$installed = 0
foreach ($t in $terminals) {
    $mql5 = Join-Path $t.DataFolder 'MQL5'
    $name = if ($t.Install) { $t.Install } else { $t.DataFolder }
    Say "MetaTrader 5 in $name" 'White'

    $linked = $false
    foreach ($part in $Parts) {
        $dst = Join-Path $mql5 $part
        if (Test-Junction $dst) {
            # A developer set-up (scripts\link-mt5.ps1) links these folders to a copy of the project.
            Say "  $part is linked to a project folder: left as it is." 'Yellow'
            $linked = $true
            continue
        }
        New-Item -ItemType Directory -Force -Path $dst | Out-Null
        Copy-Item -Path (Join-Path $Repo "mql5\$part\*") -Destination $dst -Recurse -Force
    }
    if (-not $linked) { Say '  files copied' 'Green' }

    if ($NoCompile) { $installed++; continue }
    $editor = Find-MetaEditor @($t.DataFolder)
    if (-not $editor) {
        Say '  MetaEditor was not found for this MetaTrader 5. Open it with F4 in MetaTrader 5,' 'Yellow'
        Say '  open Experts\ActionInna\ActionInna.mq5 and Scripts\ActionInna\ModernStyle.mq5, and press F7.' 'Yellow'
        continue
    }
    $ok = $true
    foreach ($rel in $Programs) {
        $problem = Compile $editor $mql5 $rel
        if ($problem) {
            Say "  could not compile $([IO.Path]::GetFileName($rel)): $problem" 'Red'
            $ok = $false
        }
        else {
            Say "  compiled $([IO.Path]::GetFileName($rel))" 'Green'
        }
    }
    if ($ok) { $installed++ }
}

Say ''
if ($installed -eq 0) {
    Say 'Nothing was installed completely. See the messages above, and README.md > Troubleshooting.' 'Red'
    exit 1
}
Say "Done: installed in $installed MetaTrader 5." 'Green'

# The Modern Screen: the program that opens the screen on MetaTrader 5's chart area.
if (-not $NoScreen) {
    Say ''
    Say 'Modern Screen' 'White'
    $app = Join-Path $env:LOCALAPPDATA 'ModernScreen\app'
    $exe = Join-Path $app 'ModernScreen.exe'
    $running = @(Get-Process -Name ModernScreen -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) {
        $running | Stop-Process -Force
        Start-Sleep -Milliseconds 500
    }
    $built = $true
    try { & (Join-Path $PSScriptRoot 'build-screen.ps1') -Out $app | Out-Null }
    catch {
        Say "  could not build the Modern Screen: $($_.Exception.Message)" 'Red'
        $built = $false
    }
    if ($built) {
        Say "  installed in $app" 'Green'
        $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
        $start = $StartWithWindows -or [bool](Get-ItemProperty -Path $runKey -Name ModernScreen -ErrorAction SilentlyContinue)
        if (-not $start) {
            $answer = Read-Host '  Start the Modern Screen with Windows, so it opens with MetaTrader 5? (Y/n)'
            $start = ($answer -eq '' -or $answer -match '^[Yy]')
        }
        if ($start) {
            Set-ItemProperty -Path $runKey -Name ModernScreen -Value ('"' + $exe + '"')
            Say '  starts with Windows' 'Green'
        }
        Start-Process -FilePath $exe
        Say '  running: its icon is in the taskbar corner, by the clock' 'Green'
    }
}
Say ''
Say 'Next, in MetaTrader 5:'
Say '  1. In the Navigator (Ctrl+N), right-click "Expert Advisors" and choose Refresh (or restart MT5).'
Say '  2. Turn on "Algo Trading" in the toolbar.'
Say '  3. Drag Expert Advisors > ActionInna > ActionInna onto a chart and press OK.'
Say '  4. For the chart style, drag Scripts > ActionInna > ModernStyle onto the chart and press OK.'
if (-not $NoScreen) {
    Say '  5. For the Modern Screen, once: in the Navigator right-click "Services", choose Add Service,'
    Say '     pick ModernScreen and press OK. From then on the screen opens with MetaTrader 5.'
    Say '     Ctrl+Alt+M (or the tray icon) hides it and shows it again.'
}
Say ''
Say 'Try it on a demo account first.'
