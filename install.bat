@echo off
rem Installs MetaTrader 5 Modern Style into every MetaTrader 5 on this PC. See README.md.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1" %*
echo.
pause
