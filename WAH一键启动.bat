@echo off
title WoWderhoiAH Launcher
cd /d "%~dp0"

echo ================================================
echo   WoWderhoiAH - silent one-click launcher
echo   Web server :3000 + addon watcher + AHledger sync
echo   Services run in the background (no windows).
echo ================================================
echo.

REM --- Web server (port 3000) ---
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [ok] Web server already running - skip.
) else (
    echo [..] Starting web server (hidden)...
    powershell -NoProfile -Command "Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
)

REM --- Addon scan watcher ---
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*watch-savedvars*' }) { exit 0 } else { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
    echo [ok] Addon watcher already running - skip.
) else (
    echo [..] Starting addon watcher (hidden)...
    powershell -NoProfile -Command "Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','addon:watch' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
)

REM --- AHledger website sync ---
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*ahledger-importer*' }) { exit 0 } else { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
    echo [ok] AHledger sync already running - skip.
) else (
    echo [..] Starting AHledger sync (hidden)...
    powershell -NoProfile -Command "Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','ahledger:sync' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
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
echo Done. All three services run silently in the background.
echo To stop them, run WAH一键停止.bat
pause
