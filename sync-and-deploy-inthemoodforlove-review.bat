@echo off
setlocal

set "SITE_REPO=G:\m-lucifer.github.io"
set "SOURCE_REPO=G:\pretext-examples"
set "TARGET_DIR=%SITE_REPO%\inthemoodforlove-review"

if not exist "%SITE_REPO%" (
  echo Site repo not found: %SITE_REPO%
  pause
  exit /b 1
)

if not exist "%SOURCE_REPO%" (
  echo Source repo not found: %SOURCE_REPO%
  pause
  exit /b 1
)

if not exist "%TARGET_DIR%\assets" mkdir "%TARGET_DIR%\assets"
if not exist "%TARGET_DIR%\vendor" mkdir "%TARGET_DIR%\vendor"
if not exist "%TARGET_DIR%\vendor\pretext" mkdir "%TARGET_DIR%\vendor\pretext"

copy /Y "%SOURCE_REPO%\examples\07-inthemoodforlove-review.html" "%TARGET_DIR%\index.html" >nul
if errorlevel 1 goto :copy_failed
copy /Y "%SOURCE_REPO%\examples\07-inthemoodforlove-review.js" "%TARGET_DIR%\app.js" >nul
if errorlevel 1 goto :copy_failed
copy /Y "%SOURCE_REPO%\examples\shared-wrap.js" "%TARGET_DIR%\shared-wrap.js" >nul
if errorlevel 1 goto :copy_failed
copy /Y "%SOURCE_REPO%\inthemoodforlove\*" "%TARGET_DIR%\assets\" >nul
if errorlevel 1 goto :copy_failed

cd /d "%SITE_REPO%" || (
  echo Failed to enter %SITE_REPO%
  pause
  exit /b 1
)

powershell -NoProfile -Command ^
  "(Get-Content '%TARGET_DIR%\index.html' -Raw).Replace('<a class=""back"" href=""../index.html"">Back to index</a>','<a class=""back"" href=""/"">Home</a>').Replace('<script type=""module"" src=""./07-inthemoodforlove-review.js""></script>','<script type=""module"" src=""./app.js""></script>') | Set-Content '%TARGET_DIR%\index.html'" 
if errorlevel 1 goto :rewrite_failed

powershell -NoProfile -Command ^
  "(Get-Content '%TARGET_DIR%\app.js' -Raw).Replace(""from '../node_modules/@chenglou/pretext/dist/layout.js'"",""from './vendor/pretext/layout.js'"").Replace(""const ASSET_ROOT = '../inthemoodforlove'"",""const ASSET_ROOT = './assets'"") | Set-Content '%TARGET_DIR%\app.js'"
if errorlevel 1 goto :rewrite_failed

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

:copy_failed
echo Copy failed.
pause
exit /b 1

:rewrite_failed
echo Path rewrite failed.
pause
exit /b 1
