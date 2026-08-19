@echo off
REM AgentCensus — repair the corrupted mainnet census DB on the server.
REM Pauses the cron + web app, replaces the bad DB with your known-good local
REM copy, restarts everything, then runs one refresh to catch up incrementally.
setlocal
cd /d "%~dp0"
set SSHOPTS=-o StrictHostKeyChecking=accept-new
set IPFILE=..\agentcensus-server-ip.txt
set SERVER_IP=
if exist "%IPFILE%" set /p SERVER_IP=<"%IPFILE%"
if "%SERVER_IP%"=="" set /p SERVER_IP=Enter server IP:

if exist packages\indexer\data\census-mainnet.db goto have_db
echo !! Local packages\indexer\data\census-mainnet.db not found.
goto end
:have_db

echo -- Pausing cron + web, removing corrupt mainnet DB...
ssh %SSHOPTS% root@%SERVER_IP% "mv /etc/cron.d/agentcensus /root/agentcensus.cron 2>/dev/null; systemctl stop agentcensus-web; rm -f /opt/agentcensus/packages/indexer/data/census-mainnet.db /opt/agentcensus/packages/indexer/data/census-mainnet.db-wal /opt/agentcensus/packages/indexer/data/census-mainnet.db-shm"

echo -- Uploading known-good mainnet DB (197MB - takes a few minutes)...
scp %SSHOPTS% packages\indexer\data\census-mainnet.db root@%SERVER_IP%:/opt/agentcensus/packages/indexer/data/
if errorlevel 1 goto upload_fail

echo -- Restoring cron + web, running catch-up refresh...
ssh %SSHOPTS% root@%SERVER_IP% "chown census:census /opt/agentcensus/packages/indexer/data/census-mainnet.db; mv /root/agentcensus.cron /etc/cron.d/agentcensus 2>/dev/null; systemctl start agentcensus-web; sudo -u census bash /opt/agentcensus/scripts/refresh-census.sh"
echo.
echo == Done. Mainnet DB restored and re-indexed to the chain head. ==
goto end

:upload_fail
echo !! Upload failed - re-run this script; the server web app may be stopped.
echo    To restart it manually: ssh root@%SERVER_IP% "mv /root/agentcensus.cron /etc/cron.d/agentcensus; systemctl start agentcensus-web"

:end
echo.
pause
