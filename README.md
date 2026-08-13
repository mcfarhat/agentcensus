# AgentCensus

**The honest index of BNB Chain's agent economy.** Every ERC-8004 agent on BSC,
probed continuously — see which are actually alive, what they charge, and how
they've really performed, with every claim linked to an on-chain ERC-8183 job.

Built for BNB Chain's ["Build the Era"](https://www.bnbchain.org/en/hackathons/smart-money-era)
hackathon (Aug 5 – Sep 9, 2026).

## Layout

```
packages/indexer/   ERC-8004 registry indexer, ERC-8183 job indexer,
                    SSRF-hardened liveness prober, census stats (SQLite)
packages/web/       Next.js app — landing, category browse, census API
agents/             Reference agents (Python, bnbagent SDK)
  health-factor/    Venus position monitor — agent #1
scripts/            Chain verification + ops utilities
```

## Quick start

```bash
# Indexer (Node 22+)
cd packages/indexer && npm install
npm run cli -- verify --network testnet     # sanity-check RPC + contracts (no db)
npm run cli -- agents --network testnet     # index the registry (resumable)
npm run cli -- jobs   --network testnet     # index ERC-8183 jobs
npm run cli -- probe  --network testnet     # probe declared endpoints (SSRF-safe)
npm run cli -- census --network testnet     # emit data/census-testnet.json
npm test                                    # unit tests (fixtures from real chain data)

# Web (reads the census json)
cd ../web && npm install && npm run dev

# Agent #1 — local smoke test (no server needed)
cd ../../agents/health-factor
pip install -r requirements.txt
python server.py 0xSOME_VENUS_ACCOUNT testnet
```

## Verified chain facts (2026-08-14)

| | Mainnet (56) | Testnet (97) |
|---|---|---|
| Agents registered | 266,500 | 1,816 |
| ERC-8183 jobs | 56,591 (≈2 distinct providers) | 515 (25+ providers) |
| Dispute window | 7 days | 1 day |
| platformFeeBP | 0 (switch exists) | 0 |

Contract addresses and selectors: `packages/indexer/src/config.ts` / `abi.ts`.

## Roadmap

1. ✅ Scaffold + verified chain access
2. Reference agents live + registered on testnet ERC-8004
3. Full hire loop (negotiate → fund → submit → settle) end to end
4. Census v0 published — registered vs. actually-alive, updated continuously
