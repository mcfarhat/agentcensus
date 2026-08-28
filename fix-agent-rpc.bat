@echo off
REM AgentCensus - switch testnet agents off the rate-limited RPC and show logs.
REM Safe to re-run any time; also handy as a quick log check.
setlocal
cd /d "%~dp0"
set IPFILE=..\agentcensus-server-ip.txt
set SERVER_IP=
if exist "%IPFILE%" set /p SERVER_IP=<"%IPFILE%"
if "%SERVER_IP%"=="" set /p SERVER_IP=Enter server IP:

echo == Switching testnet agent RPC to publicnode on %SERVER_IP% ==
ssh -o StrictHostKeyChecking=accept-new root@%SERVER_IP% "sed -i 's#https://data-seed-prebsc-1-s1.bnbchain.org:8545#https://bsc-testnet-rpc.publicnode.com#g' /opt/agentcensus/agents/rebalance-plan/.env /opt/agentcensus/agents/yield-scan/.env /opt/agentcensus/agents/health-factor/.env /opt/agentcensus/agents/grid-plan/.env; systemctl restart agentcensus-agent-rebalance agentcensus-agent-yield agentcensus-agent agentcensus-agent-grid; echo waiting 75s for a poll cycle...; sleep 75; echo; echo ---- rebalance agent ----; journalctl -u agentcensus-agent-rebalance -n 20 --no-pager; echo; echo ---- yield agent ----; journalctl -u agentcensus-agent-yield -n 20 --no-pager"
echo.
echo Look for job 692 / 694 being verified and submitted above.
pause
