@echo off
title Enable AutoStart on Boot - Mac RAM Advisor
cd /d "%~dp0"

set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set TARGET_VBS=%STARTUP_DIR%\MacRAMAdvisor.vbs
set APP_DIR=%~dp0

if exist "%APP_DIR%MacRAMAdvisor.exe" (
    echo Set WshShell = CreateObject("WScript.Shell") > "%TARGET_VBS%"
    echo WshShell.CurrentDirectory = "%APP_DIR%" >> "%TARGET_VBS%"
    echo WshShell.Run """%APP_DIR%MacRAMAdvisor.exe""", 0, False >> "%TARGET_VBS%"
) else (
    echo Set WshShell = CreateObject("WScript.Shell") > "%TARGET_VBS%"
    echo WshShell.CurrentDirectory = "%APP_DIR%" >> "%TARGET_VBS%"
    echo WshShell.Run "pythonw.exe ""%APP_DIR%backend_service.py""", 0, False >> "%TARGET_VBS%"
)

if exist "%TARGET_VBS%" (
    echo =====================================================================
    echo   [SUCCESS] AutoStart Enabled!
    echo   Mac RAM Advisor will now automatically run quietly in your Windows
    echo   system tray whenever you turn on or restart your PC.
    echo =====================================================================
) else (
    echo [ERROR] Failed to write to Windows Startup folder.
)
echo.
pause
