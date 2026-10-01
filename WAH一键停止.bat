@echo off
title WoWderhoiAH Stop
cd /d "%~dp0"

echo Stopping WoWderhoiAH background services...

REM Stop addon watcher
for /f "tokens=2" %%a in ('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*watch-savedvars*' } | Select-Object -ExpandProperty ProcessId"') do (
    echo Stopping addon watcher PID %%a
    taskkill /PID %%a /F >nul 2>&1
)

REM Stop dev server (find node on next dev)
for /f "tokens=2" %%a in ('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*next*dev*' } | Select-Object -ExpandProperty ProcessId"') do (
    echo Stopping web server PID %%a
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo Done.
pause
