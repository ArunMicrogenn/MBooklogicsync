@echo off
:: Check for administrative permissions
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Requesting Administrator Elevation...
    powershell -Command "Start-Process cmd -ArgumentList '/k cd /d %~dp0 && call install_service.bat' -Verb RunAs"
    exit /b
)

title BookLogic Sync Windows Service Installer
cls
echo ================================================================
echo    BookLogic Windows Service Auto-Installer
echo ================================================================
echo.

cd /d "%~dp0"

:: 1. Try using NSSM
where nssm >nul 2>&1
if %errorlevel% equ 0 (
    echo [1/3] Stopping existing service if present...
    nssm stop BookLogicSync >nul 2>&1
    nssm remove BookLogicSync confirm >nul 2>&1

    echo [2/3] Installing BookLogicSync Windows Service...
    nssm install BookLogicSync "node" "%~dp0sync_agent.js"
    nssm set BookLogicSync AppDirectory "%~dp0"
    nssm set BookLogicSync Start SERVICE_AUTO_START

    echo [3/3] Starting Service...
    nssm start BookLogicSync
    echo.
    echo ================================================================
    echo [SUCCESS] Service "BookLogicSync" is now RUNNING in services.msc!
    echo ================================================================
    pause
    exit /b
)

:: 2. Fallback: Native Windows Scheduled Task running as SYSTEM at Startup
echo [1/2] Registering Background Startup Task as SYSTEM...
schtasks /create /tn "BookLogicSync" /tr "node \"%~dp0sync_agent.js\"" /sc onstart /ru SYSTEM /rl HIGHEST /f

echo [2/2] Starting Background Process...
schtasks /run /tn "BookLogicSync"

echo.
echo ================================================================
echo [SUCCESS] BookLogic Sync is now running in the background!
echo ================================================================
pause
