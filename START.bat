@echo off
cd /d "%~dp0"

:: Ensure Node + npm are available — restore nvm symlink if broken
where node >nul 2>&1 && where npm >nul 2>&1 && goto :ready

:: nvm symlink is broken — try to restore via nvm use
if exist "%APPDATA%\nvm\nvm.exe" (
    echo Restoring Node via nvm...
    for /f "tokens=*" %%v in ('dir /b /o-n "%APPDATA%\nvm\v22.*" 2^>nul') do (
        "%APPDATA%\nvm\nvm.exe" use %%~nv >nul 2>&1
        where node >nul 2>&1 && where npm >nul 2>&1 && goto :ready
    )
    :: Fallback: try any installed version
    for /f "tokens=*" %%v in ('dir /b /o-n "%APPDATA%\nvm\v*" 2^>nul') do (
        "%APPDATA%\nvm\nvm.exe" use %%~nv >nul 2>&1
        where node >nul 2>&1 && where npm >nul 2>&1 && goto :ready
    )
)

:: Last resort: add nvm node dir directly to PATH for this session
set "PATH=%APPDATA%\nvm\v22.16.0;%APPDATA%\nvm;%PATH%"
where node >nul 2>&1 || (
    echo.
    echo GRESKA: Node nije pronadjen. Instaliraj Node 22 preko nvm.
    pause
    exit /b 1
)

:ready
node dev.js
if %errorlevel% neq 0 (
    echo.
    echo GRESKA pri pokretanju. Proveri da imas Node 22 instaliran.
    pause
)
