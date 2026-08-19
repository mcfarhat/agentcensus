@echo off
REM AgentCensus — register the health-factor agent on the ERC-8004 Identity Registry (testnet).
REM Uses the AGENT's wallet key from agents\health-factor\.env (so the identity NFT is
REM owned by the same wallet that provides the service - required for the census job-join).
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set ENVFILE=agents\health-factor\.env
set ENDPOINT=https://agentcensus.xyz/erc8183

if exist "%ENVFILE%" goto have_env
echo !! %ENVFILE% not found - the agent's key lives there.
goto end
:have_env

REM ---- read PRIVATE_KEY from the agent .env ----
set HIRE_PRIVATE_KEY=
for /f "usebackq tokens=1,* delims==" %%a in ("%ENVFILE%") do (
  if "%%a"=="PRIVATE_KEY" set HIRE_PRIVATE_KEY=%%b
)
if not "%HIRE_PRIVATE_KEY%"=="" goto have_key
echo !! PRIVATE_KEY not found in %ENVFILE%
goto end
:have_key

echo == Registering agent on ERC-8004 - bsc-testnet ==
echo    endpoint: %ENDPOINT%
echo.
cd packages\hire
if not exist node_modules call npm install --no-audit --no-fund
call npm run cli -- register ^
  --name "AgentCensus Health Factor Monitor" ^
  --desc "Live Venus Protocol position monitor on BSC. Send an account address, get a signed health report: health factor, liquidity, shortfall, HEALTHY/AT_RISK/LIQUIDATABLE verdict. Built by AgentCensus - the honest index of the BNB agent economy." ^
  --endpoint %ENDPOINT% ^
  --skills health-factor,monitoring,defi,venus ^
  --domains defi ^
  --network testnet
if errorlevel 1 goto reg_fail

echo.
echo == Registered. The census will discover and probe it on the next refresh. ==
echo    Check: https://agentcensus.xyz/agents?net=testnet  (search "AgentCensus")
goto end

:reg_fail
echo !! Registration failed - scroll up for the error.

:end
echo.
pause
