@echo off
REM ============================================================
REM  Full hire loop against the local health-factor agent (zero
REM  budget - no U tokens needed). Requires:
REM   1. run-agent.bat running in ANOTHER window
REM   2. agents\loop-test\.env  (copy .env.example: your funded
REM      BUYER test wallet key)
REM  Drives: negotiate -> createJob -> registerJob -> setBudget(0)
REM  -> fund(0) -> agent submits -> prints deliverable.
REM  Settle next day: venv\Scripts\python settle_job.py <jobId>
REM ============================================================
setlocal
cd /d "%~dp0agents\loop-test"

if not exist .env (
  echo [ERROR] agents\loop-test\.env missing - copy .env.example and fill in.
  goto :end
)

REM reuse the agent's venv (same deps + requests)
set VENVPY=..\health-factor\venv\Scripts\python.exe
if not exist %VENVPY% (
  echo [ERROR] run run-agent.bat first - it creates the shared venv.
  goto :end
)
%VENVPY% -m pip install requests --quiet

echo.
%VENVPY% hire_health_agent.py

:end
echo.
pause
