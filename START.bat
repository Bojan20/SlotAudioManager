@echo off
echo Starting Slot Audio Manager...
echo.

if not exist node_modules (
    echo node_modules not found. Running install first...
    call npm install --legacy-peer-deps
    if %errorlevel% neq 0 (
        echo Install failed! Run INSTALL.bat first.
        pause
        exit /b 1
    )
)

echo Starting Vite dev server...
start "Vite" cmd /c "cd /d "%~dp0" && npx vite"

echo Waiting for Vite to start...
timeout /t 5 /nobreak >nul

echo Launching Electron...
start "Electron" cmd /c "cd /d "%~dp0" && set ELECTRON_RUN_AS_NODE=&& node_modules\electron\dist\electron.exe ."

echo Done! Close this window.
timeout /t 3 /nobreak >nul
