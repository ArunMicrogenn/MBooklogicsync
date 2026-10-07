@echo off
title BookLogic Sync Background Service Installer
cls
echo ================================================================
echo    BookLogic Windows Auto-Installer (Windows 7 / 8 / 10 / 11)
echo ================================================================
echo.

cd /d "%~dp0"

:: 1. Check for node.exe
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH!
    echo Please install Node.js (v14.21.3 is recommended for Windows 7)
    echo.
    pause
    exit /b 1
)

:: 2. If NSSM is present, install directly as a native Windows Service in services.msc
where nssm >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] NSSM detected! Installing into services.msc...
    nssm stop BookLogicSync >nul 2>&1
    nssm remove BookLogicSync confirm >nul 2>&1

    nssm install BookLogicSync "node.exe" "%~dp0sync_agent.js"
    nssm set BookLogicSync AppDirectory "%~dp0"
    nssm set BookLogicSync Start SERVICE_AUTO_START
    nssm set BookLogicSync AppStdout "%~dp0sync.log"
    nssm set BookLogicSync AppStderr "%~dp0sync_err.log"
    nssm start BookLogicSync

    echo.
    echo ================================================================
    echo [SUCCESS] Service "BookLogicSync" is RUNNING in services.msc!
    echo ================================================================
    pause
    exit /b 0
)

:: 3. Windows 7 / 8 / 10 Native Silent Background Daemon (Zero .NET dependency)
echo [1/3] Creating invisible background launcher (start_win7_silent.vbs)...
(
echo Set WshShell = CreateObject^("WScript.Shell"^)
echo Set FSO = CreateObject^("Scripting.FileSystemObject"^)
echo CurrentDir = FSO.GetParentFolderName^(WScript.ScriptFullName^)
echo Cmd = "cmd.exe /c cd /d """ ^& CurrentDir ^& """ ^&^& node --harmony sync_agent.js"
echo WshShell.Run Cmd, 0, False
) > "%~dp0start_win7_silent.vbs"

echo [2/3] Configuring auto-start on Windows boot...
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%STARTUP_FOLDER%" (
    copy /y "%~dp0start_win7_silent.vbs" "%STARTUP_FOLDER%\BookLogicSync.vbs" >nul 2>&1
)

reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "BookLogicSync" /t REG_SZ /d "wscript.exe \"%~dp0start_win7_silent.vbs\"" /f >nul 2>&1
schtasks /create /tn "BookLogicSyncService" /tr "wscript.exe \"%~dp0start_win7_silent.vbs\"" /sc onlogon /rl HIGHEST /f >nul 2>&1

echo [3/3] Starting BookLogic Sync NOW in the background...
wscript.exe "%~dp0start_win7_silent.vbs"

echo.
echo ================================================================
echo [SUCCESS] BookLogic Sync is now RUNNING silently in background!
echo ================================================================
echo - Auto-starts every time Windows boots or you log in.
echo - Runs completely silent with NO black CMD window on screen.
echo - To verify it is running: check_win7.bat
echo - To stop the sync: stop_win7.bat
echo ================================================================
echo.
pause
