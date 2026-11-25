<#
.SYNOPSIS
    Builds ModernScreen.exe (the Modern Screen's tray program) into build\screen\.

.DESCRIPTION
    Uses the C# compiler that comes with Windows (.NET Framework 4), so nothing is downloaded.
    Copies the screen's page (screen\web) next to the program. With -Tests it also builds and runs
    the program's tests.

.PARAMETER Out
    The folder to build into (default build\screen). install.ps1 builds straight into the
    folder the program runs from.

.PARAMETER Tests
    Also builds and runs build\screen\HostTests.exe.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\build-screen.ps1 -Tests
#>
[CmdletBinding()]
param([switch]$Tests, [string]$Out)

$ErrorActionPreference = 'Stop'

$Repo = Split-Path -Parent $PSScriptRoot
$Csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $Csc)) { throw "$Csc is missing: .NET Framework 4 is part of Windows 10 and 11." }

$HostDir = Join-Path $Repo 'screen\host'
if (-not $Out) { $Out = Join-Path $Repo 'build\screen' }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$Parts = @('Frames.cs', 'Feed.cs', 'Web.cs', 'Store.cs', 'Log.cs', 'Routing.cs', 'Glue.cs', 'Host.cs') | ForEach-Object { Join-Path $HostDir $_ }
$Refs = @('/r:System.dll', '/r:System.Core.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll', '/r:System.Web.Extensions.dll')

function Invoke-Csc([string[]]$Arguments) {
    $output = & $Csc @Arguments 2>&1
    $code = $LASTEXITCODE
    $output | Where-Object { $_ -match '\b(error|warning)\b' } | ForEach-Object { Write-Host "  $_" }
    if ($code -ne 0) { throw "The C# compiler failed (exit code $code)." }
}

$Exe = Join-Path $Out 'ModernScreen.exe'
Invoke-Csc (@('/nologo', '/target:winexe', '/optimize+', '/warn:4', "/out:$Exe") + $Refs + $Parts + (Join-Path $HostDir 'Program.cs'))
Write-Host "Built $Exe"

$Web = Join-Path $Out 'web'
if (Test-Path -LiteralPath $Web) {
    # A junction (a developer's link) goes as a link only: Remove-Item -Recurse would follow it.
    if ((Get-Item -LiteralPath $Web -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { [IO.Directory]::Delete($Web) }
    else { Remove-Item -LiteralPath $Web -Recurse -Force }
}
Copy-Item -LiteralPath (Join-Path $Repo 'screen\web') -Destination $Web -Recurse
Write-Host "Copied the page to $Web"

if ($Tests) {
    $TestExe = Join-Path $Repo 'build\screen\HostTests.exe'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TestExe) | Out-Null
    Invoke-Csc (@('/nologo', '/target:exe', '/warn:4', "/out:$TestExe") + $Refs + $Parts + (Join-Path $HostDir 'tests\HostTests.cs'))
    & $TestExe
    if ($LASTEXITCODE -ne 0) { throw 'Host tests failed.' }
}
