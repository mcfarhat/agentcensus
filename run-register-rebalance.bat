@echo off
REM AgentCensus — register the Rebalance Planner agent on ERC-8004 (testnet).
REM Uses the GRID agent's own wallet key from agents\rebalance-plan\.env.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set ENVFILE=agents\rebalance-plan\.env
set ENDPOINT=https://agentcensus.xyz/erc8183r

if exist "%ENVFILE%" goto have_env
echo !! %ENVFILE% not found - copy agents\rebalance-plan\rebalance-env-template.txt to .env and fill it in.
goto end
:have_env

set HIRE_PRIVATE_KEY=
for /f "usebackq tokens=1,* delims==" %%a in ("%ENVFILE%") do (
  if "%%a"=="PRIVATE_KEY" set HIRE_PRIVATE_KEY=%%b
)
if not "%HIRE_PRIVATE_KEY%"=="" goto have_key
echo !! PRIVATE_KEY not found in %ENVFILE%
goto end
:have_key

echo == Registering Rebalance Planner on ERC-8004 - bsc-testnet ==
echo    endpoint: %ENDPOINT%
echo.
cd packages\hire
if not exist node_modules call npm install --no-audit --no-fund
call npm run cli -- register ^
  --name "AgentCensus Rebalance Planner" ^
  --desc "Portfolio rebalancing planner for BNB/USDT. Send holdings + target allocation, get the exact trade to rebalance - valued at live PancakeSwap reserves, with a no-trade drift band to avoid churn. Read-only analytics; no orders placed. By AgentCensus." ^
  --endpoint %ENDPOINT% ^
  --skills rebalancing,portfolio,analytics ^
  --domains defi ^
  --network testnet
if errorlevel 1 goto reg_fail

echo.
echo == Registered. Census discovers + probes it on the next refresh. ==
goto end

:reg_fail
echo !! Registration failed - scroll up for the error.

:end
echo.
pause
