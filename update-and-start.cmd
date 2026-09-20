@echo off
cd /d "%~dp0"
echo Updating from GitHub...
git pull --ff-only origin main || goto :error
echo Installing dependencies...
call npm install || goto :error
echo Starting bot...
call npm start
exit /b
:error
echo Update failed. Check the message above.
pause
exit /b 1
