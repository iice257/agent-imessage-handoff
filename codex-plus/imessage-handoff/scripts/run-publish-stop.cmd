@echo off
setlocal

set "NODE_OPTIONS_CURRENT=%NODE_OPTIONS%"
echo %NODE_OPTIONS_CURRENT% | findstr /C:"--use-system-ca" >nul
if errorlevel 1 (
  if "%NODE_OPTIONS%"=="" (
    set "NODE_OPTIONS=--use-system-ca"
  ) else (
    set "NODE_OPTIONS=%NODE_OPTIONS% --use-system-ca"
  )
)

node "%~dp0publish-stop.js"
exit /b 0
