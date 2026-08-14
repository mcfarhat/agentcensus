@echo off
REM ============================================================
REM  AgentCensus first-live-test v2 - one click:
REM    1. repair git history: drop the 197MB census db from the
REM       unpushed commit, then push clean
REM    2. install the hire package
REM    3. try the testnet U faucet
REM    4. run the settle-sweeper on 3 stuck testnet jobs
REM
REM  KEY: either run  set HIRE_PRIVATE_KEY=0x...  in this window
REM  before launching, or paste it when prompted below. Use a
REM  FRESH TESTNET-ONLY wallet with a little tBNB. Never a wallet
REM  holding real funds. The key is not written to disk.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo [1/4] Repairing git: removing local census data from the commit...
git fetch origin
git reset --soft origin/main
git rm -r --cached packages/indexer/data >nul 2>nul
git add -A
git commit -m "census publication + hire loop + indexer v2" 2>nul
if errorlevel 1 echo   nothing new to commit
git push origin main
if errorlevel 1 echo [WARN] push still failing - send me the error text. Continuing...

echo.
echo [2/4] Installing hire package...
cd packages\hire
if exist node_modules goto :depsok
call npm install --no-audit --no-fund
if errorlevel 1 goto :fail
:depsok
echo   dependencies ready.

if not "%HIRE_PRIVATE_KEY%"=="" goto :havekey
echo.
echo Paste your TESTNET-ONLY private key. Use a fresh throwaway wallet
echo funded with a little tBNB from the official faucet - NEVER a
echo wallet holding real funds. Input is visible on screen.
set /p HIRE_PRIVATE_KEY=key:
:havekey
if not "%HIRE_PRIVATE_KEY%"=="" goto :run
echo [ERROR] no key provided.
goto :end

:run
echo.
echo [3/4] Trying testnet U faucet - a revert here is OK and expected...
call npm run --silent cli -- faucet --network testnet --amount 10
if errorlevel 1 echo   faucet unavailable. The sweep below needs no U, only tBNB gas.

echo.
echo [4/4] Settle-sweeper: releasing escrow on up to 3 stuck testnet jobs...
call npm run --silent cli -- sweep --network testnet --max 3
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo  DONE. Check any tx hashes above on https://testnet.bscscan.com
echo ============================================================
goto :end

:fail
echo.
echo [ERROR] a step failed - scroll up for details. Safe to re-run.

:end
echo.
pause
