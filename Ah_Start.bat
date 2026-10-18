@echo off
chcp 65001 >nul
title WoWderhoiAH Launcher
cd /d "%~dp0"

REM All launch logic lives in scripts\launch-services.ps1 (robust detection,
REM fully detached hidden node processes, per-service logs).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-services.ps1"

echo.
pause
