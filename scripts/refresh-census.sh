#!/usr/bin/env bash
# AgentCensus — hourly incremental refresh (run by cron as the census user).
# Each step resumes from the last indexed id, so this is cheap after the first run.
set -u
cd /opt/agentcensus/packages/indexer

echo "=== refresh $(date -u +%FT%TZ) ==="
for NET in testnet mainnet; do
  npm run --silent cli -- agents --network "$NET" || echo "warn: agents $NET failed"
  npm run --silent cli -- jobs   --network "$NET" || echo "warn: jobs $NET failed"
  npm run --silent cli -- probe  --network "$NET" || echo "warn: probe $NET failed"
  npm run --silent cli -- census --network "$NET" || echo "warn: census $NET failed"
done
# --- settle-sweeper: release escrow on testnet jobs past their dispute window ---
# Uses the Judge Mode relayer key (testnet-only) for gas. Permissionless public good.
ENVF=/opt/agentcensus/packages/web/.env.local
if [ -f "$ENVF" ]; then
  HIRE_PRIVATE_KEY=$(grep -E '^JUDGE_RELAYER_KEY=' "$ENVF" | head -1 | cut -d= -f2)
  export HIRE_PRIVATE_KEY
  if [ -n "$HIRE_PRIVATE_KEY" ] && [ -d /opt/agentcensus/packages/hire/node_modules ]; then
    cd /opt/agentcensus/packages/hire
    npm run --silent cli -- sweep --network testnet --max 5 || echo "warn: sweep failed"
  fi
fi

echo "=== done $(date -u +%FT%TZ) ==="
