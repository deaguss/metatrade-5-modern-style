@echo off
rem Removes MetaTrader 5 Modern Style from every MetaTrader 5 on this PC. It asks first.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uninstall.ps1" %*
echo.
pause
