@echo off
REM AgentCensus — one-click server deploy.
REM Pushes latest code, runs server setup over SSH, uploads census DBs + agent .env.
REM Requires: server created on Hetzner with your SSH key; Windows built-in ssh/scp.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set DOMAIN=agentcensus.xyz
set REPO_URL=https://github.com/mcfarhat/agentcensus.git
set IPFILE=..\agentcensus-server-ip.txt
set SSHOPTS=-o StrictHostKeyChecking=accept-new

REM ---- server IP (remembered outside the repo) ----
set SERVER_IP=
if exist "%IPFILE%" set /p SERVER_IP=<"%IPFILE%"
if not "%SERVER_IP%"=="" goto have_ip
set /p SERVER_IP=Enter server IP:
echo %SERVER_IP%>"%IPFILE%"
:have_ip
echo.
echo == Deploying to %SERVER_IP% ==
echo.

REM ---- 1. push latest code ----
echo -- Git status:
git status --short
set PUSH=y
set /p PUSH=Push latest code to GitHub first? [y/n] default y:
if /i "%PUSH%"=="n" goto skip_push
git add -A
git commit -m "deploy: server setup + latest work"
git push origin main
if errorlevel 1 goto push_fail
:skip_push

REM ---- 2. run server setup ----
echo.
echo -- Running server setup, this takes a few minutes on first run...
scp %SSHOPTS% scripts\server-setup.sh root@%SERVER_IP%:/root/server-setup.sh
if errorlevel 1 goto ssh_fail
ssh %SSHOPTS% root@%SERVER_IP% "DOMAIN=%DOMAIN% REPO_URL=%REPO_URL% bash /root/server-setup.sh"
if errorlevel 1 goto setup_fail

REM ---- 3. upload census databases ----
echo.
echo -- Uploading census databases...
if exist packages\indexer\data\census-testnet.db scp %SSHOPTS% packages\indexer\data\census-testnet.db root@%SERVER_IP%:/opt/agentcensus/packages/indexer/data/
if exist packages\indexer\data\census-mainnet.db scp %SSHOPTS% packages\indexer\data\census-mainnet.db root@%SERVER_IP%:/opt/agentcensus/packages/indexer/data/

REM ---- 4. upload agent .env and point its public URL at the domain ----
if not exist agents\health-factor\.env goto no_env
echo -- Uploading agent .env...
scp %SSHOPTS% agents\health-factor\.env root@%SERVER_IP%:/opt/agentcensus/agents/health-factor/.env
ssh %SSHOPTS% root@%SERVER_IP% "sed -i 's#^ERC8183_AGENT_URL=.*#ERC8183_AGENT_URL=https://%DOMAIN%/erc8183#' /opt/agentcensus/agents/health-factor/.env && systemctl enable --now agentcensus-agent"
:no_env

REM ---- 5. fix ownership, restart, verify ----
ssh %SSHOPTS% root@%SERVER_IP% "chown -R census:census /opt/agentcensus && systemctl restart agentcensus-web && sleep 3 && systemctl --no-pager --lines=0 status agentcensus-web caddy | grep -E 'agentcensus-web|caddy|Active:'"
echo.
echo ============================================================
echo  Deploy complete.
echo  Site:      https://%DOMAIN%   [after DNS below]
echo  Direct IP: http://%SERVER_IP%  will NOT serve the site  -
echo             Caddy serves the domain name only.
echo.
echo  DNS records to add at your registrar for %DOMAIN%:
echo    A     @      %SERVER_IP%
echo    A     www    %SERVER_IP%
echo  HTTPS goes live automatically a few minutes after DNS.
echo ============================================================
goto end

:push_fail
echo !! git push failed - fix and re-run.
goto end
:ssh_fail
echo !! Could not reach the server over SSH. Check the IP and that the server is running.
goto end
:setup_fail
echo !! Server setup reported an error - scroll up for details. Re-running this script is safe.
goto end

:end
echo.
pause
