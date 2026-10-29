@echo off
title "Mac RAM Advisor — 1-Click Launch & Monitor"
cd /d "%~dp0"

echo =====================================================================
echo             Mac RAM Advisor — 1-Click Launch & Monitor
echo =====================================================================
echo.

:: 1. If standalone binary already compiled, launch immediately!
if exist "%~dp0dist\backend_service\MacRAMAdvisor.exe" (
    echo [1/1] Launching Mac RAM Advisor...
    start "" "%~dp0dist\backend_service\MacRAMAdvisor.exe"
    goto success
)

if exist "%~dp0MacRAMAdvisor.exe" (
    echo [1/1] Launching Mac RAM Advisor...
    start "" "%~dp0MacRAMAdvisor.exe"
    goto success
)

:: 2. Source development fallback: Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Pre-built binary not found and Python is not installed.
    echo Download the release zip from GitHub Releases, or install Python 3.10+.
    pause
    exit /b 1
)

echo [1/3] Checking dependencies...
python -m pip install -q psutil fastapi uvicorn pillow >nul 2>&1

echo [2/3] Compiling native Windows Tray Host...
if exist "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" (
    C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /win32icon:assets\icon.ico /out:MacRAMAdvisor.exe TrayHost.cs >nul 2>&1
)

echo [3/3] Starting in System Tray...
start "" "MacRAMAdvisor.exe"

:success
echo.
echo =====================================================================
echo   [SUCCESS] Mac RAM Advisor is active in your Windows System Tray!
echo   Click the tray icon anytime to view your Mac RAM dashboard.
echo =====================================================================
timeout /t 3 >nul
exit /b 0
