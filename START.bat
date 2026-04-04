@echo off
cd /d "%~dp0"

:: Dodaj nvm node direktno u PATH ako node nije dostupan
where node >nul 2>&1 || set "PATH=%APPDATA%\nvm\v22.16.0;%APPDATA%\nvm;%PATH%"

node dev.js
if %errorlevel% neq 0 (
    echo.
    echo GRESKA pri pokretanju. Proveri da imas Node 22 instaliran.
    pause
)
