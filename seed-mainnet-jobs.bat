@echo off
REM AgentCensus — seed MAINNET demo jobs against our health-factor agent (#270183).
REM Full lifecycle on real BSC: negotiate -> createJob -> registerJob -> setBudget(0)
REM -> fund(0) -> agent submits. Settle after the 7-DAY dispute window (sweep).
REM
REM PREREQS:
REM  1. mainnet agent instance running (deploy-server.bat after creating
REM     agents\health-factor\.env.mainnet) — check: https://agentcensus.xyz/erc8183m/negotiate
REM     should answer 405 in the browser.
REM  2. mainnet-buyer.env in this folder (gitignored) with one line:
REM       HIRE_PRIVATE_KEY=0x...   (a FRESH buyer wallet holding ~0.01 real BNB for gas)
REM  3. Agent wallet holds a little real BNB for submit() gas (~0.0005/job).
REM
REM RUN BY ~SEP 1 so the 7-day window fully elapses before judging (Sep 9).
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set PROVIDER=0x0475c8fa8ac94888eab9b4329b93c263708a9a07
set ENDPOINT=https://agentcensus.xyz/erc8183m
set JOBS=3

if exist mainnet-buyer.env goto have_env
echo !! mainnet-buyer.env not found. Create it here with: HIRE_PRIVATE_KEY=0x...
goto end
:have_env

set HIRE_PRIVATE_KEY=
for /f "usebackq tokens=1,* delims==" %%a in ("mainnet-buyer.env") do (
  if "%%a"=="HIRE_PRIVATE_KEY" set HIRE_PRIVATE_KEY=%%b
)
if not "%HIRE_PRIVATE_KEY%"=="" goto have_key
echo !! HIRE_PRIVATE_KEY not found in mainnet-buyer.env
goto end
:have_key

echo ============================================================
echo  MAINNET demo-job seeding: %JOBS% zero-budget jobs against
echo  our agent %PROVIDER%
echo  This spends a small amount of REAL BNB on gas (buyer wallet).
echo ============================================================
set GO=
set /p GO=Type y to continue:
if /i not "%GO%"=="y" goto end

cd packages\hire
if not exist node_modules call npm install --no-audit --no-fund

for /l %%i in (1,1,%JOBS%) do (
  echo.
  echo ---- Seeding demo job %%i of %JOBS% ----
  call npm run cli -- hire --network mainnet ^
    --provider %PROVIDER% ^
    --endpoint %ENDPOINT% ^
    --task "AgentCensus mainnet demo job %%i: report Venus Protocol account health at current block and submit the signed report on-chain." ^
    --budget 0 --wait
  if errorlevel 1 echo !! job %%i failed - continuing with the next one
)

echo.
echo == Seeding done. Jobs enter the 7-day dispute window now. ==
echo    Settle after Aug 27+ with:  npm run cli -- sweep --network mainnet --max 5
echo    (run from packages\hire with this same HIRE_PRIVATE_KEY set)
echo    Verify anytime: https://agentcensus.xyz/agent/mainnet/270183

:end
echo.
pause
