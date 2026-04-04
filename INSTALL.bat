@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
echo =============================================
echo   Slot Audio Manager - Windows Install
echo =============================================
echo.

:: If node not in PATH, try nvm-windows
where node >nul 2>&1
if %errorlevel% neq 0 (
    if exist "%APPDATA%\nvm\nvm.exe" (
        set "NODE_VER="
        for /d %%d in ("%APPDATA%\nvm\v*") do set "NODE_VER=%%~nxd"
        if defined NODE_VER (
            echo Aktiviram !NODE_VER! preko nvm...
            "%APPDATA%\nvm\nvm.exe" use !NODE_VER:v=!
            set "PATH=%APPDATA%\nvm;%APPDATA%\nvm\!NODE_VER!;%PATH%"
        )
    )
)

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Download from: https://nodejs.org/
    echo Install the LTS version, then run this again.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo Node.js version: %NODE_VER%
echo.

:: Check Git
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo WARNING: Git is not installed. Git features will not work.
    echo Download from: https://git-scm.com/
    echo.
) else (
    for /f "tokens=*" %%i in ('git --version') do echo %%i
    echo.
)

:: Install dependencies
echo Installing dependencies (this may take a few minutes)...
echo.
call npm install --legacy-peer-deps
if %errorlevel% neq 0 (
    echo.
    echo ERROR: npm install failed!
    echo Try running: npm install --legacy-peer-deps
    pause
    exit /b 1
)

echo.
echo =============================================
echo   Install complete!
echo.
echo   To start the app, run:  npm run dev
echo   Or double-click:        START.bat
echo =============================================
pause
