@echo off

echo ========================================
echo  First-time Login Setup
echo ========================================
echo.
echo [IMPORTANT] This is required only on first use.
echo Run FirstTimeSetup_生成AI初回設定.bat once, login to each AI service,
echo then close Chrome. After that, use BulkSearch_生成AI一括検索.bat.
echo.
echo Please login to each service:
echo   - Gemini    : https://gemini.google.com/
echo   - ChatGPT   : https://chatgpt.com/
echo   - Claude    : https://claude.ai/
echo   - Perplexity: https://www.perplexity.ai/
echo.
echo ========================================
echo.

cd /d "%~dp0"

set "CHROME_EXE="

if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
  set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
  set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

if "%CHROME_EXE%"=="" (
  echo [ERROR] Chrome not found.
  pause
  exit /b 1
)

echo Launching Chrome...
echo Profile: %~dp0chrome-profile
echo.

start "" "%CHROME_EXE%" --user-data-dir="%~dp0chrome-profile" --no-first-run --no-default-browser-check "https://gemini.google.com/" "https://chatgpt.com/" "https://claude.ai/" "https://www.perplexity.ai/"

echo Chrome launched. Login to each AI service then close Chrome.
echo After that, run BulkSearch_生成AI一括検索.bat.
echo.
