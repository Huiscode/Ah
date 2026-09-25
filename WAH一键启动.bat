@echo off
title WoWderhoiAH Launcher
cd /d "%~dp0"

echo ================================================
echo   WoWderhoiAH - one-click launcher
echo   Web server on port 3000 + scan importer
echo   Already-running services are skipped.
echo ================================================
echo.

set "DEV_RUNNING="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do set "DEV_RUNNING=1"

set "WATCH_RUNNING="
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*watch-savedvars*' }; if ($p) { exit 0 } else { exit 1 }" >nul 2>&1
if %errorlevel%==0 set "WATCH_RUNNING=1"

if defined DEV_RUNNING (
    echo [ok] Web server already running on port 3000 - skip.
) else (
    echo [..] Starting web server: npm run dev
    start "WAH-Web" cmd /k "npm run dev"
)

if defined WATCH_RUNNING (
    echo [ok] Scan importer already running - skip.
) else (
    echo [..] Starting scan importer: npm run addon:watch
    start "WAH-Watch" cmd /k "npm run addon:watch"
)

echo.
echo [..] Waiting for the web server - max 60s ...
set /a tries=0
:waitloop
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>&1
if %errorlevel%==0 goto open
set /a tries+=1
if %tries% GEQ 60 goto open
timeout /t 1 /nobreak >nul
goto waitloop

:open
echo [ok] Opening http://localhost:3000
start "" "http://localhost:3000"
echo.
echo Done. Keep the two black windows open; closing them stops the services.
pause
