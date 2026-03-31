@echo off
setlocal

set "SITE_REPO=G:\m-lucifer.github.io"

if not exist "%SITE_REPO%" (
  echo Site repo not found: %SITE_REPO%
  pause
  exit /b 1
)

cd /d "%SITE_REPO%" || (
  echo Failed to enter %SITE_REPO%
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SITE_REPO%\sync-inthemoodforlove-review.ps1"
if errorlevel 1 (
  echo Sync failed.
  pause
  exit /b 1
)

git add .

git diff --cached --quiet
if %errorlevel%==0 (
  echo No staged changes to commit.
  pause
  exit /b 0
)

git commit -m "Update In the Mood for Love review page"
if errorlevel 1 (
  echo Commit failed.
  pause
  exit /b 1
)

git push origin master
if errorlevel 1 (
  echo Push failed.
  pause
  exit /b 1
)

echo.
echo Sync and deploy finished.
pause
exit /b 0
