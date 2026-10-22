@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13+ is required. Read README_RU.md.
  pause
  exit /b 1
)
node --env-file-if-exists=.env server/index.mjs
pause
