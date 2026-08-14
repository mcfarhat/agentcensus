@echo off
REM ============================================================
REM  AgentCensus one-click pipeline (Windows)
REM  Double-click to run the full testnet pass:
REM    verify -> index agents -> index jobs -> probe -> census
REM  Or from a terminal:  run-census.bat mainnet
REM  (mainnet agent indexing = ~533k RPC calls; hours on public
REM   RPC - do it once, later runs resume where they stopped)
REM ============================================================
setlocal
cd /d "%~dp0packages\indexer"

set NETWORK=%1
if "%NETWORK%"=="" set NETWORK=testnet

echo.
echo === AgentCensus pipeline on %NETWORK% ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node 22+ from https://nodejs.org and retry.
  goto :end
)

if not exist node_modules (
  echo [1/6] First run - installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :fail
) else (
  echo [1/6] Dependencies present - skipping install.
)

echo.
echo [2/6] Verifying RPC + contracts...
call npm run --silent cli -- verify --network %NETWORK%
if errorlevel 1 goto :fail

echo.
echo [3/6] Indexing ERC-8004 registry (resumable - safe to re-run)...
call npm run --silent cli -- agents --network %NETWORK%
if errorlevel 1 goto :fail

echo.
echo [4/6] Indexing ERC-8183 jobs...
call npm run --silent cli -- jobs --network %NETWORK%
if errorlevel 1 goto :fail

echo.
echo [5/6] Probing declared agent endpoints (SSRF-hardened)...
call npm run --silent cli -- probe --network %NETWORK% --limit 2000
if errorlevel 1 goto :fail

echo.
echo [6/6] Computing census...
call npm run --silent cli -- census --network %NETWORK% > nul
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo  DONE. Census written to:
echo    packages\indexer\data\census-%NETWORK%.json
echo ============================================================
echo.
type "data\census-%NETWORK%.json"
goto :end

:fail
echo.
echo [ERROR] Step failed - scroll up for details. The pipeline is
echo resumable: fix the issue and double-click again; completed
echo work is not repeated.

:end
echo.
pause
