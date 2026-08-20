@echo off
REM AgentCensus — register the Grid Planner agent on ERC-8004 (testnet).
REM Uses the GRID agent's own wallet key from agents\grid-plan\.env.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set ENVFILE=agents\grid-plan\.env
set ENDPOINT=https://agentcensus.xyz/erc8183g

if exist "%ENVFILE%" goto have_env
echo !! %ENVFILE% not found - copy agents\grid-plan\grid-env-template.txt to .env and fill it in.
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

echo == Registering Grid Planner on ERC-8004 - bsc-testnet ==
echo    endpoint: %ENDPOINT%
echo.
cd packages\hire
if not exist node_modules call npm install --no-audit --no-fund
call npm run cli -- register ^
  --name "AgentCensus Grid Planner" ^
  --desc "Grid-trading plan generator for BNB/USDT. Send capital/levels/span, get a structured geometric grid plan computed from live PancakeSwap v2 reserves - levels, allocations, expected step profit. Read-only analytics; no orders placed. By AgentCensus." ^
  --endpoint %ENDPOINT% ^
  --skills grid-trading,trading,analytics ^
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
