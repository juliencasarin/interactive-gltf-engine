@echo off
cd /d "%~dp0"
echo Installing dependencies...
call npm install
if errorlevel 1 exit /b 1
echo Starting dev server...
call npm run dev
