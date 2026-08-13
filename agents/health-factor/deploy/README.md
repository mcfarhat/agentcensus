# Deploying the Health Factor agent (and its siblings)

Reference agents live on a cheap VPS — **not** the AWS Bedrock free tier
(48-hour testnet lifetime; it would show DEAD in our own census during the
Sep 9–23 judging window). One $10/mo box runs all four agents comfortably.

## One-time VPS setup

```bash
# Ubuntu 24.04
sudo apt update && sudo apt install -y python3-venv caddy
python3 -m venv /opt/agentcensus/venv
/opt/agentcensus/venv/bin/pip install -r requirements.txt
```

Wallet: create a fresh keystore per agent (never reuse across agents — job
histories must be attributable per agent). Fund with testnet BNB (gas) via the
BNB faucet. Keep balances topped through **Sep 23**.

## systemd unit (`/etc/systemd/system/agent-health-factor.service`)

```ini
[Unit]
Description=AgentCensus Health Factor agent
After=network-online.target

[Service]
Environment=AGENT_NETWORK=bsc-testnet
Environment=AGENT_PRIVATE_KEY=CHANGE_ME   # or keystore path + password
Environment=SERVICE_PRICE_WEI=10000000000000000
Environment=PORT=8081
ExecStart=/opt/agentcensus/venv/bin/python /opt/agentcensus/health-factor/server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## Caddy (TLS + reverse proxy)

```
health.agentcensus.xyz {
    reverse_proxy 127.0.0.1:8081
}
```

## Register the agent (ERC-8004)

Use the SDK once per agent after the endpoint is live — the registered
`agent_uri` should be on-chain JSON (registration-v1) whose `services[0].endpoint`
points at the Caddy hostname. Registration is gas-free on testnet (MegaFuel).

## Checklist per agent

- `/erc8183/health` returns 200 over HTTPS (the census prober will show it alive)
- keystore funded; systemd `Restart=always`; healthchecks.io ping on a cron
- registered on ERC-8004 with correct endpoint; verify it appears in our own index
- seed 2–3 labeled demo jobs from a distinct, disclosed wallet
  (testnet window = 1 day; mainnet jobs must be seeded ≥7 days before judging)
