@echo off
REM AgentCensus — settle mainnet demo jobs whose 7-day dispute window elapsed.
REM Permissionless sweep: releases each SUBMITTED-past-window job to COMPLETED.
REM Uses the same buyer key as seeding (mainnet-buyer.env, gitignored).
setlocal EnableDelayedExpansion
cd /d "%~dp0"

if exist mainnet-buyer.env goto have_env
echo !! mainnet-buyer.env not found next to this script.
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

cd packages\hire
if not exist node_modules call npm install --no-audit --no-fund

echo.
echo == Sweeping mainnet: settling SUBMITTED jobs past their dispute window ==
call npm run cli -- sweep --network mainnet --max 10
echo.
echo == Second pass (catches any remainder) ==
call npm run cli -- sweep --network mainnet --max 10

echo.
echo Done. Verify at https://agentcensus.xyz/agent/mainnet/270183
echo (jobs show COMPLETED after the site's next hourly refresh)

:end
echo.
pause
