@echo off
chcp 65001 >nul
title WhatsApp Admin Bot - Student Gate
cd /d "%~dp0"

if not exist "node_modules" (
  echo [Setup] Installing dependencies for the first time...
  call npm install
  if errorlevel 1 goto :error
)

echo ========================================
echo Starting WhatsApp Admin Bot...
echo Old dashboard: http://127.0.0.1:3000
echo Student Gate:  http://127.0.0.1:3001
echo ========================================
echo.
call npm start

if errorlevel 1 goto :error
echo.
echo Bot stopped.
pause
exit /b 0

:error
echo.
echo The bot could not start. Review the error above.
pause
exit /b 1
