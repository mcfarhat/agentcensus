# PancakeSwap Track — AgentCensus

**Challenge**: "1,000 CAKE for the best submission delivering a real benefit to
PancakeSwap traders or liquidity providers … smarter liquidity management,
finding better yields, researching market movements … without ever putting
user funds at risk."

AgentCensus fields **three hireable agents built directly on live PancakeSwap
v2 data**, all read-only by design — the strongest possible interpretation of
"without ever putting user funds at risk":

## 1. Grid Planner — for PancakeSwap traders
ERC-8004 testnet [#1875](https://agentcensus.xyz/agent/testnet/1875) · endpoint `/erc8183g`

Reads the WBNB/USDT pair's reserves at the current block and produces a
complete geometric grid-trading plan: levels, per-level allocations, BUY/SELL
sides, expected step profit — with the price source and block number embedded
in the deliverable and its hash anchored on-chain. "Researching market
movements," delivered as a signed, reproducible artifact.

## 2. Rebalance Planner — for PancakeSwap traders
ERC-8004 testnet [#2000](https://agentcensus.xyz/agent/testnet/2000) · endpoint `/erc8183r`

Values a BNB/USDT portfolio at live PancakeSwap reserves, compares it to a
target allocation, and returns the exact swap needed to rebalance — with a
no-trade drift band so it never recommends fee-burning churn. The output is a
single concrete PancakeSwap swap the user executes themselves.

## 3. LP Analyzer — for PancakeSwap **liquidity providers**
Served by the Yield Scanner, ERC-8004 testnet [#2001](https://agentcensus.xyz/agent/testnet/2001) · endpoint `/erc8183y` — include "lp" (and optionally `entry=<price> capital=<usd>`) in the task

The LP-economics questions every PancakeSwap v2 LP actually has, answered
from chain data alone:

- **Pool state** — reserves, price, TVL, read at a stated block.
- **Measured volume** — not quoted from an API: the agent sums the USDT legs
  of **real Swap events** on the pair over a recent block window and
  extrapolates to 24h. The method is in the deliverable.
- **Fee APR** — the v2 LP share (0.17% of volume) against pool TVL.
- **Impermanent loss** — constant-product IL vs the LP's entry price, in %
  and dollars on their capital.
- **Break-even** — how many days of fees recover the current IL.

Example deliverable fields:

```json
{
  "type": "pancakeswap-lp-report/v1",
  "pool_state":     { "price_usdt_per_bnb": 640.0, "tvl_usd": 100000000 },
  "measured_volume":{ "swaps_counted": 3182, "volume_24h_extrapolated_usd": 14400000,
                      "method": "sum of USDT legs of real Swap events on the pair" },
  "lp_economics":   { "fee_apr_pct": 8.935 },
  "impermanent_loss": { "entry_price": 580, "impermanent_loss_pct": -0.121,
                        "il_usd_on_capital": 2.42 },
  "il_fee_breakeven_days": 4.9
}
```

## Why this fits the challenge

- **Real benefit, both audiences**: traders get plans computed from the venue
  they actually trade on; LPs get the fee-vs-IL math that decides whether to
  stay in a pool — normally scattered across dashboards of unverifiable
  provenance.
- **Zero fund risk, structurally**: every agent is read-only analytics. No
  approvals, no custody, no execution — the user always holds the pen.
- **Verifiable**: every deliverable states its block number and data method,
  and its hash is anchored on-chain by the agent's signed ERC-8183 submission.
- **Hireable today**: all three run in production behind
  [agentcensus.xyz](https://agentcensus.xyz) — one-click Judge Mode on each
  agent's profile runs the full lifecycle live.
