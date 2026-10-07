@echo off
title Stop BookLogic Sync (Windows 7)
cls
echo ================================================================
echo    Stopping BookLogic Background Sync
echo ================================================================
echo.

taskkill /F /IM node.exe >nul 2>&1
echo [OK] Stopped any running node.exe background processes.
echo.
pause
