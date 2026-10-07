@echo off
title Fix Windows 7 Node Dependencies for BookLogic Sync
cls
echo ================================================================
echo    Fixing Windows 7 / Node 13 Compatible Dependencies
echo ================================================================
echo.

cd /d "%~dp0"

echo [1/3] Removing modern incompatible node_modules...
if exist node_modules rd /s /q node_modules
if exist package-lock.json del /f /q package-lock.json

echo.
echo [2/3] Installing Node 13 / Windows 7 native libraries (mssql@6.3.2)...
call npm install mssql@6.3.2 pg@8.7.3 dotenv --save

echo.
echo [3/3] Testing sync agent connection...
node sync_agent.js

pause
