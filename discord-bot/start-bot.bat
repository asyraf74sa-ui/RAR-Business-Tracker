@echo off
cd /d "%~dp0"

if not exist ".env" (
  echo Missing discord-bot\.env. Copy .env.example to .env and fill in your credentials.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Dependencies are not installed. Run npm install in this folder first.
  pause
  exit /b 1
)

call npm start

if errorlevel 1 (
  echo.
  echo The bot stopped with an error. Review the message above.
  pause
)
