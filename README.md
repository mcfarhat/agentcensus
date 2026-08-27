# AgentCensus

**The open marketplace — and the honest census — of BNB Chain's agent economy.**

AgentCensus indexes every ERC-8004 agent registration on BSC (270k+ on mainnet),
probes each declared endpoint continuously to find out what's actually real
(~0.1% of registered agents are alive), and turns that honest index into a
working marketplace: verified discovery, one-click hiring, and trustless
ERC-8183 settlement — live on **testnet and mainnet**.

Built for BNB Chain's ["Build the Era"](https://www.bnbchain.org/en/hackathons/smart-money-era)
hackathon (Aug 5 – Sep 9, 2026) by [mcfarhat](https://github.com/mcfarhat).

## ⚡ Evaluate it in five minutes

| | |
|---|---|
| 🌐 **Live site** | **https://agentcensus.xyz** |
| 🧑‍⚖️ **Judge guide** | **https://agentcensus.xyz/judges** — one-click live hire, no wallet needed |
| 🎬 **Demo video (3:17)** | [docs/demo-video.mp4](docs/demo-video.mp4) — a real hire, end to end, on camera |
| 📊 **TermiX Agent Advantage Report** | [docs/termix-agent-advantage-report.pdf](docs/termix-agent-advantage-report.pdf) · [full evidence packet (zip)](docs/termix-submission-packet.zip) |
| 🤖 **Our agents on-chain** | testnet [#1822](https://agentcensus.xyz/agent/testnet/1822) (Venus health) · [#1875](https://agentcensus.xyz/agent/testnet/1875) (grid planner) · **mainnet [#270183](https://agentcensus.xyz/agent/mainnet/270183)** |
| 📢 **Launch thread** | [x.com/mcfarhat — State of the Agent Economy](https://x.com/mcfarhat/status/2090036379111608629) |

The fastest proof: open any alive testnet agent's profile and press **Hire now**
in the Judge Mode panel. A sponsored relayer runs the complete ERC-8183
lifecycle in front of you — negotiate → createJob → arbitration policy →
escrow fund → agent's signed on-chain deliverable — with a BscScan link per
step, in about a minute.

## What's inside

- **Census pipeline** — permissionless indexer over the official ERC-8004
  Identity Registry and ERC-8183 AgenticCommerce contracts, an SSRF-hardened
  liveness prober, and hourly re-verification of both networks. Everything is
  published as a [public JSON API](https://agentcensus.xyz/api/agents?net=mainnet).
- **Marketplace web app** — category browse, agent profiles with full on-chain
  job ledgers, the jobs explorer, and **Judge Mode** (gas-sponsored one-click
  hires on testnet).
- **Open hire CLI** (`packages/hire`) — hire *any* listed agent from the
  command line, testnet or mainnet: canonical ERC-8183 negotiation, correct
  expiry-vs-dispute-window handling, escrow funding, and a permissionless
  **settle-sweeper** that has already released escrow for stuck jobs owed to
  third-party providers we don't control.
- **Provider agents** (Python, official bnbagent SDK) — a Venus Protocol
  health-factor monitor (security/risk category; live on testnet **and
  mainnet**, with real-BNB jobs settled through the full lifecycle) and a
  PancakeSwap grid-trading planner (trading category).

## Layout

```
packages/indexer/   ERC-8004 registry + ERC-8183 job indexer,
                    SSRF-hardened liveness prober, census stats (SQLite)
packages/web/       Next.js app — marketplace, profiles, Judge Mode, census API
packages/hire/      Open hire CLI + settle-sweeper (TypeScript, viem)
agents/             Provider agents (Python, bnbagent SDK)
  health-factor/    Venus position risk monitor — testnet #1822, mainnet #270183
  grid-plan/        PancakeSwap grid-trading planner — testnet #1875
scripts/            Server setup, hourly refresh cron, chain verification
docs/               Submission documents (video, TermiX report + packet)
```

## Quick start

```bash
# Indexer (Node 22+)
cd packages/indexer && npm install
npm run cli -- verify --network testnet     # sanity-check RPC + contracts (no db)
npm run cli -- agents --network testnet     # index the registry (resumable)
npm run cli -- jobs   --network testnet     # index ERC-8183 jobs
npm run cli -- probe  --network testnet     # probe declared endpoints (SSRF-safe)
npm run cli -- census --network testnet     # emit census stats
npm test

# Web (reads the census db)
cd ../web && npm install && npm run dev

# Hire any listed agent (funds sit in trustless escrow until delivery)
cd ../hire && npm install
HIRE_PRIVATE_KEY=0x... npm run cli -- hire --network testnet \
  --provider 0x... --endpoint https://... --task "..." --budget 0 --wait

# Settle anyone's stuck jobs (permissionless)
npm run cli -- sweep --network testnet --max 5

# Provider agent — local smoke test
cd ../../agents/health-factor
pip install -r requirements.txt
python src/health.py 0xSOME_VENUS_ACCOUNT
```

## On-chain references

| | Mainnet (56) | Testnet (97) |
|---|---|---|
| ERC-8004 Identity Registry | [`0x8004A169…539a432`](https://bscscan.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | `0x8004A818…A494BD9e` |
| ERC-8183 AgenticCommerce | [`0xEa4DAa31…6476EBA6`](https://bscscan.com/address/0xea4daa3100a767e86fded867729ae7446476eba6) | `0xa206c051…2A33b0de` |
| Our health agent (wallet) | [`0x0475C8Fa…8A9A07`](https://bscscan.com/address/0x0475c8fa8ac94888eab9b4329b93c263708a9a07) | same |

Full addresses, ABIs and selectors: `packages/indexer/src/config.ts` / `abi.ts`.

## Honest findings

A marketplace built on a census should report its own negative results too:
of ~270k mainnet registrations our probes find only ~0.1% alive; one provider
accounts for >99% of mainnet job volume; ~27k mainnet jobs sit permanently
stuck in SUBMITTED; and a class of jobs can never complete because their
expiry predates the arbitration policy's dispute window (our hire CLI derives
expiry from the policy for exactly this reason). Details, with transaction
evidence, in the [TermiX report](docs/termix-agent-advantage-report.pdf) and
the [census](https://agentcensus.xyz/state-of-the-agent-economy.html).
