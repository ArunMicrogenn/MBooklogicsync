@echo off
title BookLogic Background Sync Installer for Windows 7
cls
echo ================================================================
echo    BookLogic Background Sync Installer (Windows 7 / 8 / 10)
echo ================================================================
echo.

cd /d "%~dp0"

:: 1. Verify Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not recognized in PATH!
    echo Please ensure Node.js is installed on this Windows 7 machine.
    echo (For Windows 7, Node.js v14.21.3 is the official compatible version)
    echo.
    pause
    exit /b 1
)

echo [1/4] Creating hidden background launcher (start_win7_silent.vbs)...
(
echo Set WshShell = CreateObject^("WScript.Shell"^)
echo Set FSO = CreateObject^("Scripting.FileSystemObject"^)
echo CurrentDir = FSO.GetParentFolderName^(WScript.ScriptFullName^)
echo Cmd = "cmd.exe /c cd /d """ ^& CurrentDir ^& """ ^&^& node --harmony sync_agent.js"
echo WshShell.Run Cmd, 0, False
) > "%~dp0start_win7_silent.vbs"
echo [OK] Launcher created.

echo.
echo [2/4] Registering auto-start on Windows boot / user logon...

:: Copy to Startup folder
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%STARTUP_FOLDER%" (
    copy /y "%~dp0start_win7_silent.vbs" "%STARTUP_FOLDER%\BookLogicSync.vbs" >nul 2>&1
    echo [OK] Added to Windows Startup Folder: "%STARTUP_FOLDER%\BookLogicSync.vbs"
)

:: Also add to Windows Registry Run key for 100%% boot persistence
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "BookLogicSync" /t REG_SZ /d "wscript.exe \"%~dp0start_win7_silent.vbs\"" /f >nul 2>&1
echo [OK] Added to Windows Registry Auto-Run (HKCU\...\Run)

:: Also create a Windows 7 Scheduled Task
schtasks /create /tn "BookLogicSyncService" /tr "wscript.exe \"%~dp0start_win7_silent.vbs\"" /sc onlogon /rl HIGHEST /f >nul 2>&1
echo [OK] Registered in Windows 7 Task Scheduler (taskschd.msc)

echo.
echo [3/4] Terminating any stale node sync instances...
taskkill /F /FI "WINDOWTITLE eq *sync_agent*" >nul 2>&1

echo.
echo [4/4] Starting BookLogic Sync NOW in silent background mode...
wscript.exe "%~dp0start_win7_silent.vbs"

echo.
echo ================================================================
echo   SUCCESS! BookLogic Sync is now RUNNING silently in background!
echo ================================================================
echo.
echo - Starts automatically whenever Windows 7 boots or you log in.
echo - Runs completely in the background without any blocking popup.
echo - To check status, run: check_win7.bat
echo - To stop sync, run: stop_win7.bat
echo.
pause
