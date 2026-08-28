@echo off
REM AgentCensus x Altana - scoped-session hiring demo (BSC testnet).
REM Creates an Altana smart wallet, grants a Keystore-registered session key
REM (allowlist + 5 $U/day cap + 7d expiry), then hires our health agent
REM (#1822) THROUGH THE SESSION KEY with a real 1 $U escrow.
setlocal EnableDelayedExpansion
cd /d "%~dp0packages\altana"

if exist .env goto have_env
echo !! packages\altana\.env not found - copy altana-env-template.txt to .env
echo    and set ALTANA_ADMIN_KEY to a NEW fresh testnet key.
goto end
:have_env

if not exist node_modules call npm install --no-audit --no-fund

if exist .altana-session.json goto have_session
echo == 1. Setup: wallet + faucet + scoped session (Keystore-registered) ==
call node cli.mjs setup
if errorlevel 1 goto fail
:have_session

echo.
echo == 2. Hire AgentCensus agent #1822 via the SESSION key (1 $U escrow) ==
call node cli.mjs hire
if errorlevel 1 goto fail

echo.
echo == 3. Waiting 90s for the agent to submit on-chain... ==
timeout /t 90 /nobreak > nul
call node cli.mjs job

echo.
echo == Done. Status / next steps ==
call node cli.mjs status
echo.
echo   After the 15-min dispute window:  node cli.mjs settle
echo   Revoke the session any time:      node cli.mjs revoke
echo   Verify in Altana explorer:        https://testnet.altana.network
goto end

:fail
echo !! step failed - scroll up for the error.
:end
echo.
pause
