@echo off

echo ========================================
echo  Chrome Launch Script
echo ========================================


cd /d "%~dp0"

:: Node.js のパスを環境変数 PATH に追加（新規インストール直後などの反映対策）
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
