@echo off
rem Double-click launcher for Windows: runs agent-tel's run.sh with Git Bash.
rem Copy it anywhere (Desktop, ...) and set AGENT_TEL_DIR to where the repo
rem lives on this machine.
setlocal
set "AGENT_TEL_DIR=C:\path\to\agent-tel"

rem Run from inside the repo, this file finds it on its own.
if not exist "%AGENT_TEL_DIR%\run.sh" set "AGENT_TEL_DIR=%~dp0.."
if not exist "%AGENT_TEL_DIR%\run.sh" (
  echo Can't find agent-tel's run.sh. Edit AGENT_TEL_DIR at the top of:
  echo   %~f0
  pause
  exit /b 1
)

set "BASH="
if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined BASH if exist "%LocalAppData%\Programs\Git\bin\bash.exe" set "BASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not defined BASH (
  echo Git Bash is required to run run.sh. Install Git for Windows from https://git-scm.com
  pause
  exit /b 1
)

cd /d "%AGENT_TEL_DIR%"
"%BASH%" ./run.sh %*
rem Keep the window open if the server stops with an error.
if errorlevel 1 pause
