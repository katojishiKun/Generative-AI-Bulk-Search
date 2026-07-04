@echo off

echo ========================================
echo  Chrome Launch Script
echo ========================================


cd /d "%~dp0"

:: Add Node.js to PATH (in case it was just installed and PATH is not yet updated)
where node >nul 2>nul
if %errorlevel% neq 0 (
  if exist "C:\Program Files\nodejs" (
    set "PATH=C:\Program Files\nodejs;%PATH%"
  )
)

if not exist "node_modules" (
  echo Running npm install...
  npm install
  echo.
)

echo Starting Chrome...
npx ts-node --esm open-generative.ts

echo.
echo Done.
pause