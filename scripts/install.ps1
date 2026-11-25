<#
.SYNOPSIS
    Installs MetaTrader 5 Modern Style into every MetaTrader 5 on this PC and compiles it.

.DESCRIPTION
    Run it with install.bat (double-click). It needs MetaTrader 5 for Windows, opened at least once.

    For each MetaTrader 5 data folder of this Windows user it copies, from this folder:
        mql5\Experts\ActionInna   ->  <data folder>\MQL5\Experts\ActionInna
        mql5\Include\ActionInna   ->  <data folder>\MQL5\Include\ActionInna
        mql5\Scripts\ActionInna   ->  <data folder>\MQL5\Scripts\ActionInna
    then compiles the ActionInna order ticket and the ModernStyle script with that terminal's own
    MetaEditor. Nothing else on the PC is changed. Running it again updates the files.

.PARAMETER NoCompile
    Copy the files only. Compile them in MetaEditor yourself (F4 in MetaTrader 5, then F7).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#>
[CmdletBinding()]
param([switch]$NoCompile)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$Repo = Split-Path -Parent $PSScriptRoot
$Parts = @('Experts\ActionInna', 'Include\ActionInna', 'Scripts\ActionInna')
$Programs = @('Experts\ActionInna\ActionInna.mq5', 'Scripts\ActionInna\ModernStyle.mq5')

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
Say ''
Say 'Next, in MetaTrader 5:'
Say '  1. In the Navigator (Ctrl+N), right-click "Expert Advisors" and choose Refresh (or restart MT5).'
Say '  2. Turn on "Algo Trading" in the toolbar.'
Say '  3. Drag Expert Advisors > ActionInna > ActionInna onto a chart and press OK.'
Say '  4. For the chart style, drag Scripts > ActionInna > ModernStyle onto the chart and press OK.'
Say ''
Say 'Try it on a demo account first.'
