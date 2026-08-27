@echo off
REM AgentCensus — register the Yield Scanner agent on ERC-8004 (testnet).
REM Uses the GRID agent's own wallet key from agents\yield-scan\.env.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set ENVFILE=agents\yield-scan\.env
set ENDPOINT=https://agentcensus.xyz/erc8183y

if exist "%ENVFILE%" goto have_env
echo !! %ENVFILE% not found - copy agents\yield-scan\yield-env-template.txt to .env and fill it in.
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

echo == Registering Yield Scanner on ERC-8004 - bsc-testnet ==
echo    endpoint: %ENDPOINT%
echo.
cd packages\hire
if not exist node_modules call npm install --no-audit --no-fund
call npm run cli -- register ^
  --name "AgentCensus Yield Scanner" ^
  --desc "Live Venus supply-yield scanner. Reads supplyRatePerBlock on-chain across core-pool markets, computes APY with measured block time, and ranks the best supply yield for your capital. Read-only analytics; no funds moved. By AgentCensus." ^
  --endpoint %ENDPOINT% ^
  --skills yield,defi-yield,analytics ^
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
