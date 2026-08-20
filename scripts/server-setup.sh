#!/usr/bin/env bash
# AgentCensus — one-shot server setup for Ubuntu 24.04 / 26.04 (run as root).
# Idempotent: safe to re-run. Usage:
#   DOMAIN=agentcensus.xyz REPO_URL=https://github.com/mcfarhat/agentcensus.git bash server-setup.sh
set -euo pipefail

DOMAIN="${DOMAIN:-agentcensus.xyz}"
REPO_URL="${REPO_URL:-https://github.com/mcfarhat/agentcensus.git}"
APP_DIR=/opt/agentcensus
APP_USER=census

echo "== AgentCensus server setup — domain: $DOMAIN =="

# ---- 1. Swap (2G) so `next build` never gets OOM-killed on 4GB RAM ----
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "-- swap: 2G enabled"
fi

# ---- 2. Base packages ----
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git build-essential python3 python3-venv python3-pip \
  ca-certificates gnupg ufw debian-keyring debian-archive-keyring apt-transport-https

# ---- 3. Node 22 (NodeSource) ----
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "-- node: $(node -v), npm: $(npm -v)"

# ---- 4. Caddy (auto-HTTPS reverse proxy) ----
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

# ---- 5. Firewall ----
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
echo "-- ufw: 22/80/443 open"

# ---- 6. App user + repo ----
id -u $APP_USER >/dev/null 2>&1 || useradd -m -s /bin/bash $APP_USER
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi
mkdir -p "$APP_DIR/packages/indexer/data"
chown -R $APP_USER:$APP_USER "$APP_DIR"

# ---- 7. Build indexer + hire CLI + web (as app user) ----
sudo -u $APP_USER bash -c "cd $APP_DIR/packages/indexer && npm install --no-audit --no-fund"
sudo -u $APP_USER bash -c "cd $APP_DIR/packages/hire && npm install --no-audit --no-fund"
sudo -u $APP_USER bash -c "cd $APP_DIR/packages/web && npm install --no-audit --no-fund && npm run build"

# ---- 8. Python venvs for the agents ----
sudo -u $APP_USER bash -c "cd $APP_DIR/agents/health-factor && python3 -m venv venv && venv/bin/pip install -q --upgrade pip && venv/bin/pip install -q -r requirements.txt"
sudo -u $APP_USER bash -c "cd $APP_DIR/agents/grid-plan && python3 -m venv venv && venv/bin/pip install -q --upgrade pip && venv/bin/pip install -q -r requirements.txt"

# ---- 9. systemd: web app ----
cat > /etc/systemd/system/agentcensus-web.service <<EOF
[Unit]
Description=AgentCensus web app (Next.js)
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/packages/web
ExecStart=/usr/bin/node node_modules/.bin/next start -p 3000
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# ---- 10. systemd: health-factor agent (enabled later, once .env exists) ----
cat > /etc/systemd/system/agentcensus-agent.service <<EOF
[Unit]
Description=AgentCensus health-factor agent (ERC-8183 provider)
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/agents/health-factor
ExecStart=$APP_DIR/agents/health-factor/venv/bin/python scripts/run_agent.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# ---- 10b. systemd: MAINNET agent instance (port 8004; enabled once .env.mainnet exists) ----
# systemd env wins over load_dotenv (python-dotenv never overrides existing vars),
# so the same code dir serves both networks with different EnvironmentFiles.
cat > /etc/systemd/system/agentcensus-agent-mainnet.service <<EOF
[Unit]
Description=AgentCensus health-factor agent — MAINNET (ERC-8183 provider)
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/agents/health-factor
EnvironmentFile=$APP_DIR/agents/health-factor/.env.mainnet
ExecStart=$APP_DIR/agents/health-factor/venv/bin/python scripts/run_agent.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# ---- 10c. systemd: Grid Planner agent (port 8005; enabled once its .env exists) ----
cat > /etc/systemd/system/agentcensus-agent-grid.service <<EOF
[Unit]
Description=AgentCensus Grid Planner agent (ERC-8183 provider, trading)
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/agents/grid-plan
ExecStart=$APP_DIR/agents/grid-plan/venv/bin/python scripts/run_agent.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# ---- 11. Hourly census refresh (incremental; CLI resumes from max id) ----
touch /var/log/agentcensus-refresh.log
chown $APP_USER:$APP_USER /var/log/agentcensus-refresh.log
cat > /etc/cron.d/agentcensus <<EOF
7 * * * * $APP_USER bash $APP_DIR/scripts/refresh-census.sh >> /var/log/agentcensus-refresh.log 2>&1
EOF

# ---- 12. Caddy: HTTPS for the site + /erc8183 route to the agent ----
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	handle /erc8183m* {
		uri replace /erc8183m /erc8183
		reverse_proxy 127.0.0.1:8004
	}
	handle /erc8183g* {
		uri replace /erc8183g /erc8183
		reverse_proxy 127.0.0.1:8005
	}
	handle /erc8183* {
		reverse_proxy 127.0.0.1:8003
	}
	handle {
		reverse_proxy 127.0.0.1:3000
	}
}
www.$DOMAIN {
	redir https://$DOMAIN{uri} permanent
}
EOF

systemctl daemon-reload
systemctl enable --now agentcensus-web
systemctl restart caddy

# Enable the agent only if its .env has been uploaded
if [ -f "$APP_DIR/agents/health-factor/.env" ]; then
  systemctl enable --now agentcensus-agent
  echo "-- agent (testnet): enabled"
else
  echo "-- agent (testnet): waiting for agents/health-factor/.env (deploy script uploads it)"
fi
if [ -f "$APP_DIR/agents/health-factor/.env.mainnet" ]; then
  systemctl enable --now agentcensus-agent-mainnet
  echo "-- agent (mainnet): enabled"
else
  echo "-- agent (mainnet): waiting for agents/health-factor/.env.mainnet"
fi
if [ -f "$APP_DIR/agents/grid-plan/.env" ]; then
  systemctl enable --now agentcensus-agent-grid
  echo "-- agent (grid): enabled"
else
  echo "-- agent (grid): waiting for agents/grid-plan/.env"
fi

echo ""
echo "== Done. =="
echo "Site:  https://$DOMAIN  (HTTPS activates once DNS points here)"
echo "Check: systemctl status agentcensus-web caddy --no-pager"
