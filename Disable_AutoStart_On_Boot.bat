@echo off
title Disable AutoStart on Boot - Mac RAM Advisor
cd /d "%~dp0"

set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set TARGET_VBS=%STARTUP_DIR%\MacRAMAdvisor.vbs

if exist "%TARGET_VBS%" (
    del "%TARGET_VBS%"
    echo =====================================================================
    echo   [SUCCESS] AutoStart Disabled!
    echo   Mac RAM Advisor will no longer start when Windows boots up.
    echo =====================================================================
) else (
    echo =====================================================================
    echo   [INFO] AutoStart was not enabled on this computer.
    echo =====================================================================
)
echo.
pause
