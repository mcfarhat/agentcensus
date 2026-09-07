@echo off
REM AgentCensus - pre-judging server survival check (read-only, safe to run anytime).
REM Verifies: disk headroom, memory, every service enabled-on-boot + running,
REM census freshness (db mtime), cron installed, log disk usage, recent OOM/errors.
setlocal
cd /d "%~dp0"
set IPFILE=..\agentcensus-server-ip.txt
set SERVER_IP=
if exist "%IPFILE%" set /p SERVER_IP=<"%IPFILE%"
if "%SERVER_IP%"=="" set /p SERVER_IP=Enter server IP:

echo == AgentCensus server health @ %SERVER_IP% ==
ssh -o StrictHostKeyChecking=accept-new root@%SERVER_IP% "echo '---- uptime / load ----'; uptime; echo; echo '---- disk (want ample Avail on /) ----'; df -h / ; echo; echo '---- memory (want available > 300MB) ----'; free -m; echo; echo '---- services: every line must say enabled + active ----'; for s in agentcensus-web agentcensus-agent agentcensus-agent-mainnet agentcensus-agent-grid agentcensus-agent-rebalance agentcensus-agent-yield caddy; do printf '%%-28s %%-10s %%s\n' $s $(systemctl is-enabled $s 2>/dev/null) $(systemctl is-active $s 2>/dev/null); done; echo; echo '---- census freshness (db files should be modified within the last ~70 min) ----'; ls -l --time-style=+'%%Y-%%m-%%d %%H:%%M' /opt/agentcensus/packages/indexer/data/*.db 2>/dev/null; date '+now: %%Y-%%m-%%d %%H:%%M %%Z'; echo; echo '---- hourly refresh cron ----'; crontab -l 2>/dev/null | grep -v '^#' ; echo; echo '---- journald disk usage (vacuum if > 1G: journalctl --vacuum-size=500M) ----'; journalctl --disk-usage; echo; echo '---- OOM / kill events in last 7 days (want NONE) ----'; journalctl --since -7d 2>/dev/null | grep -i -E 'out of memory|oom-kill|killed process' | tail -5; echo '(blank above = good)'; echo; echo '---- reboot simulation: services enabled on boot? any disabled above must be fixed with: systemctl enable <name> ----'"
echo.
echo Review above: disk Avail healthy, all services enabled+active, dbs fresh,
echo cron present, no OOM lines. Fix anything off BEFORE Sep 9.
pause
