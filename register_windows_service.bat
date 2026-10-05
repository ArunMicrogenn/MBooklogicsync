@echo off
title BookLogic Windows Service Installer
echo ================================================================
echo   Installing BookLogic SQL Sync Service into Windows Services
echo ================================================================
echo.

cd /d "%~dp0"

echo [1/3] Installing node-windows package...
call npm install -g node-windows --silent >nul 2>&1
call npm link node-windows --silent >nul 2>&1

echo [2/3] Registering Windows Service "BookLogic SQL Sync Service"...
node install_service.js

echo.
echo [3/3] Creating Auto-Start Task in Windows Task Scheduler as fallback...
schtasks /create /tn "BookLogicSyncService" /tr "\"%ProgramFiles%\nodejs\node.exe\" \"%~dp0sync_agent.js\"" /sc onstart /ru SYSTEM /rl HIGHEST /f >nul 2>&1
schtasks /run /tn "BookLogicSyncService" >nul 2>&1

echo.
echo ================================================================
echo   SUCCESS! 
echo   1. Open services.msc and press F5 (Refresh).
echo   2. Look under letter "B" for "BookLogic SQL Sync Service".
echo   3. Or check Windows Task Scheduler (taskschd.msc).
echo ================================================================
pause
