@echo off
title Check BookLogic Sync Status (Windows 7)
cls
echo ================================================================
echo    Checking BookLogic Background Sync Status
echo ================================================================
echo.

tasklist /FI "IMAGENAME eq node.exe" | findstr /i "node.exe" >nul 2>&1
if %errorlevel% equ 0 (
    echo [RUNNING] Node.js process is active and running in background!
    echo.
    tasklist /FI "IMAGENAME eq node.exe"
) else (
    echo [STOPPED] Node.js sync agent is NOT running.
    echo Run "install_win7.bat" or "wscript.exe start_win7_silent.vbs" to start it.
)

echo.
echo Checking Windows Startup entry:
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BookLogicSync.vbs" (
    echo [OK] Startup folder persistence is ACTIVE.
) else (
    echo [WARN] Startup folder file not found.
)

echo.
pause
