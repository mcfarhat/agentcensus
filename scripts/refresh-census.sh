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
echo "=== done $(date -u +%FT%TZ) ==="
