@echo off
setlocal

cd /d G:\m-lucifer.github.io || (
  echo Failed to enter G:\m-lucifer.github.io
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
echo Deploy finished.
pause
