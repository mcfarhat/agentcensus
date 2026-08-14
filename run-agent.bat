@echo off
REM ============================================================
REM  Start the AgentCensus Health Factor agent (window stays open).
REM  First run: creates a venv, installs deps, and needs
REM  agents\health-factor\.env  (copy .env.example, fill in a
REM  FRESH testnet key for the AGENT wallet - different from your
REM  buyer wallet - plus WALLET_PASSWORD).
REM  Leave this window running; the loop test talks to it.
REM ============================================================
setlocal
cd /d "%~dp0agents\health-factor"

if not exist .env (
  echo [ERROR] agents\health-factor\.env missing.
  echo Copy .env.example to .env and fill in PRIVATE_KEY + WALLET_PASSWORD.
  goto :end
)

if not exist venv (
  echo [setup] creating venv + installing deps - one-time, ~2 min...
  python -m venv venv
  call venv\Scripts\pip install -r requirements.txt --quiet
  if errorlevel 1 goto :fail
)

echo.
echo Starting agent on http://localhost:8003  - press Ctrl+C to stop.
echo Agent wallet address will appear at http://localhost:8003/erc8183/status
echo.
venv\Scripts\python scripts\run_agent.py
goto :end

:fail
echo [ERROR] setup failed - scroll up.

:end
echo.
pause
