@echo off
setlocal enabledelayedexpansion

set "CAMEL_ROOT=%~dp0"
set "NODE_EXE="

rem -- 1. Use version named in node\.active ----------------------------------
if exist "%CAMEL_ROOT%node\.active" (
  set /p _ACT=<"%CAMEL_ROOT%node\.active"
  if exist "%CAMEL_ROOT%node\!_ACT!\node.exe" (
    set "NODE_EXE=%CAMEL_ROOT%node\!_ACT!\node.exe"
  )
)

rem -- 2. Newest version folder inside camel\node\ ---------------------------
if not defined NODE_EXE (
  for /f "delims=" %%F in ('dir /b /od "%CAMEL_ROOT%node" 2^>nul') do (
    if exist "%CAMEL_ROOT%node\%%F\node.exe" (
      set "NODE_EXE=%CAMEL_ROOT%node\%%F\node.exe"
    )
  )
)

rem -- 3. Fallback: sibling node-v* folder (original layout) ----------------
if not defined NODE_EXE (
  for /f "delims=" %%F in ('dir /b /od "%CAMEL_ROOT%.." 2^>nul') do (
    if exist "%CAMEL_ROOT%..\%%F\node.exe" (
      set "NODE_EXE=%CAMEL_ROOT%..\%%F\node.exe"
    )
  )
)

rem -- 4. Fallback: system Node.js on PATH ------------------------------------
if not defined NODE_EXE (
  where node >nul 2>&1
  if not errorlevel 1 (
    set "NODE_EXE=node"
  )
)

if not defined NODE_EXE (
  echo [camel] Node.js not found.
  echo        Option 1: Install Node.js from https://nodejs.org and re-run this command.
  echo        Option 2: Place node-v*-win-x64 inside:  %CAMEL_ROOT%node\
  exit /b 1
)

"!NODE_EXE!" "%CAMEL_ROOT%index.js" %*
