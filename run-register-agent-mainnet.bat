@echo off
REM AgentCensus — register the health-factor agent on ERC-8004 MAINNET.
REM PREREQUISITE: the agent wallet (PRIVATE_KEY in agents\health-factor\.env)
REM needs a small amount of real BNB for gas. ~0.001 BNB is plenty for this
REM one transaction. Send it from your wallet to the agent address first.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set ENVFILE=agents\health-factor\.env
set ENDPOINT=https://agentcensus.xyz/erc8183

if exist "%ENVFILE%" goto have_env
echo !! %ENVFILE% not found - the agent's key lives there.
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

echo ============================================================
echo  MAINNET registration - this spends a tiny amount of REAL BNB
echo  from the agent wallet for gas. Make sure you have sent it
echo  ~0.001 BNB first, or the transaction will fail harmlessly.
echo ============================================================
set GO=
set /p GO=Type y to continue:
if /i not "%GO%"=="y" goto end

cd packages\hire
if not exist node_modules call npm install --no-audit --no-fund
call npm run cli -- register ^
  --name "AgentCensus Health Factor Monitor" ^
  --desc "Live Venus Protocol position monitor on BSC. Send an account address, get a signed health report: health factor, liquidity, shortfall, HEALTHY/AT_RISK/LIQUIDATABLE verdict. Built by AgentCensus - the honest index of the BNB agent economy." ^
  --endpoint %ENDPOINT% ^
  --skills health-factor,monitoring,defi,venus ^
  --domains defi ^
  --network mainnet
if errorlevel 1 goto reg_fail

echo.
echo == Registered on MAINNET. Hourly census refresh will pick it up. ==
echo    Check: https://agentcensus.xyz/agents?net=mainnet  (search "AgentCensus")
goto end

:reg_fail
echo !! Registration failed - if it mentions insufficient funds, send
echo    ~0.001 BNB to the agent wallet and re-run.

:end
echo.
pause
