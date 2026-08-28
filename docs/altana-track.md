# Altana Track — Scoped-Session Agent Hiring

**Challenge**: build on Altana Network's smart-wallet stack — session keys with
on-chain scopes, Keystore registration, atomic revocation.

AgentCensus demonstrates the exact thing scoped sessions exist for: **hiring
autonomous agents without handing over the treasury.** A human-owned Altana
smart wallet grants a session key a narrow, on-chain-enforced mandate — *these
four contracts, at most 5 $U a day, for seven days* — and that session key then
runs complete ERC-8183 hire → deliver → settle lifecycles against our live
marketplace agents. Everything below happened on BSC testnet and is verifiable
on-chain.

## What was proven

| Step | Evidence (BSC testnet) |
|---|---|
| Smart wallet (admin-owned) | [`0x0D5fc890…9e75dDe4`](https://testnet.bscscan.com/address/0x0D5fc8904322FBFDa2Ea5D5B739891de9e75dDe4) |
| Scoped session, Keystore-registered | Keystore `0x6b8361C2…171E94A` — call allowlist (ERC-8183 commerce + router, $U token, $U faucet), spend caps **5 $U/day + 0.02 tBNB/day native**, 7-day expiry |
| Session-key hire, real escrow | Job **#703**, 1 $U escrowed — tx [`0xd8e39582…8c8f5cbc`](https://testnet.bscscan.com/tx/0xd8e39582c57aafda98ed6d090a94e9e889d55db9d2078978a10ebe668c8f5cbc) |
| Agent delivery | Our Venus health-factor agent ([testnet #1822](https://agentcensus.xyz/agent/testnet/1822)) verified and submitted its signed deliverable on-chain within ~a minute |
| Session-key settlement | `settle 703` approved the deliverable and released the 1 $U — job **COMPLETED**, full lifecycle closed without the admin key ever touching the chain |
| Session-key refund | Expired job #696's escrow reclaimed via `claimRefund` — tx [`0xe4657700…20c85e4`](https://testnet.bscscan.com/tx/0xe4657700d7af4be3f690d296d6db4a3bde7b354bef04553e7c985431520c85e4) |

$U is Altana's stablecoin ("United Stables",
[`0xc70B8741…648E5565`](https://testnet.bscscan.com/address/0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565));
the testnet faucet dispenses 10 $U per 30 minutes.

## The code

`packages/altana/cli.mjs` — a self-contained CLI over `@altananetwork/sdk`:

```bash
node cli.mjs setup        # create wallet, relay-faucet tBNB, $U faucet,
                          # grant + Keystore-register the scoped session
node cli.mjs hire         # hire an AgentCensus agent via the SESSION key (1 $U)
node cli.mjs job <id>     # ERC-8183 job status
node cli.mjs settle <id>  # approve the deliverable via the session key
node cli.mjs refund <id>  # reclaim escrow from an expired job
node cli.mjs revoke       # atomic revocation (Keystore + account)
```

One-click: `run-altana-demo.bat` at the repo root. The only input is a fresh
throwaway admin key in `.env-altana` — no pre-funding needed; the relay faucet
covers gas. Session state persists to a gitignored `.altana-session.json`.

## Why this matters for an agent marketplace

Autonomous hiring has an obvious trust problem: an agent that can spend your
wallet can drain your wallet. Altana's scoped sessions are the missing
primitive — the census/marketplace finds a *verified* agent, and the session
key hires it under a mandate the chain itself enforces. The 5 $U/day cap is
not a UI promise: we watched the relay reject out-of-scope operations at the
protocol level (see finding 2).

## Honest findings (reported to the Altana team)

In AgentCensus tradition, the negative results are part of the deliverable.
Building this surfaced four real ecosystem issues, each worked around in code:

1. **Relay fees come from the smart wallet's native balance.** A freshly
   created wallet has zero tBNB, so its first `execute` reverts on fees
   (`feeToken 0x0`). Fix: `fundNative` against the testnet relay faucet as
   setup step 1b, then `waitForBalance` before proceeding.
2. **Sessions must carry a native spend limit, not just token caps.** A
   session granted only a $U cap is rejected at execution with
   `NoSpendPermissions` — relay gas is itself metered spend. This is spend-cap
   enforcement working *exactly as advertised*, but it is easy to miss: we add
   an explicit `0.02 tBNB/day` native permission alongside the $U cap.
3. **The SDK's preset testnet arbitration policy is de-whitelisted.** Hiring
   through the SDK's default addresses reverts in `registerJob` with
   `PolicyNotWhitelisted` (`0xc94463e3`). We rebuild the hire calls manually
   and bind the currently whitelisted OptimisticPolicy
   (`0xd6a42175…ad771cea`, 900 s dispute window) instead.
4. **Provider-side deadline mismatch.** The provider SDK computes its
   submission deadline as `expiredAt −` *its own* preset dispute window (1 day
   on testnet), not the window of the policy actually bound to the job. A job
   whose expiry is padded only for the real 900 s window gets silently skipped
   as "deadline passed" (our first attempt, job #696, died this way). Buyers
   must over-pad: our CLI sets `expiredAt = now + disputeWindow + 48 h`.

Findings 3 and 4 mirror what our census sees at scale on mainnet — a whole
class of ERC-8183 jobs that can never complete because expiry and dispute
windows disagree. The tooling that found them is the marketplace itself.
