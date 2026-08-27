"""AgentCensus Yield Scanner — live Venus supply-APY report.

Read-only yield analytics: reads supplyRatePerBlock from Venus core-pool
vTokens on BSC mainnet, measures the chain's actual block time from recent
block timestamps (so APY math survives BSC block-time changes), and emits a
ranked supply-yield report. No funds are handled — the deliverable is the
report itself, anchored on-chain per ERC-8183.
"""
from __future__ import annotations

import json
import re
import time

import requests

MAINNET_RPC = "https://bsc-dataseed.bnbchain.org"
SUPPLY_RATE = "0xae9d70b0"  # supplyRatePerBlock()

# Venus core-pool vTokens (BSC mainnet).
MARKETS = {
    "BNB": "0xA07c5b74C9B40447a954e1466938b865b6BBea36",
    "USDT": "0xfD5840Cd36d94D7229439859C0112a4185BC0255",
    "USDC": "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
    "ETH": "0xf508fCD89b8bd15579dc79A6827cB4686A3592c8",
    "BTCB": "0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B",
}

SECONDS_PER_YEAR = 365 * 24 * 3600
SAMPLE_SPAN = 5000  # blocks used to measure real block time


def _rpc(method: str, params: list):
    r = requests.post(
        MAINNET_RPC,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        timeout=8,
    )
    r.raise_for_status()
    out = r.json()
    if "error" in out:
        raise RuntimeError(out["error"])
    return out["result"]


def _block_time() -> tuple[float, int]:
    """Measure the chain's real average block time over the last SAMPLE_SPAN blocks."""
    latest = _rpc("eth_getBlockByNumber", ["latest", False])
    n = int(latest["number"], 16)
    t1 = int(latest["timestamp"], 16)
    older = _rpc("eth_getBlockByNumber", [hex(n - SAMPLE_SPAN), False])
    t0 = int(older["timestamp"], 16)
    return (t1 - t0) / SAMPLE_SPAN, n


def _num(task: str, key: str) -> float | None:
    m = re.search(rf"{key}\s*[:=]?\s*(\d+(?:\.\d+)?)", task, re.IGNORECASE)
    return float(m.group(1)) if m else None


def run_task(task_text: str) -> str:
    """Scan Venus supply yields. Task may override: capital=<usd> (allocation sizing)."""
    started = time.time()
    task = task_text or ""
    capital = _num(task, "capital") or 1000.0

    try:
        sec_per_block, block = _block_time()
        blocks_per_year = SECONDS_PER_YEAR / sec_per_block
        markets = []
        for sym, vtoken in MARKETS.items():
            try:
                raw = _rpc("eth_call", [{"to": vtoken, "data": SUPPLY_RATE}, "latest"])
                rate = int(raw, 16) / 1e18  # per-block rate, 1e18 mantissa
                # Compound-style APY with daily compounding
                blocks_per_day = blocks_per_year / 365
                apy = ((rate * blocks_per_day + 1) ** 365 - 1) * 100
                markets.append({
                    "asset": sym,
                    "vtoken": vtoken,
                    "supply_rate_per_block": rate,
                    "supply_apy_pct": round(apy, 3),
                })
            except Exception as e:  # single-market failure shouldn't kill the scan
                markets.append({"asset": sym, "vtoken": vtoken, "error": str(e)[:80]})

        ranked = sorted(
            [m for m in markets if "supply_apy_pct" in m],
            key=lambda m: m["supply_apy_pct"],
            reverse=True,
        )
        best = ranked[0] if ranked else None
        report = {
            "type": "yield-scan/v1",
            "protocol": "Venus core pool",
            "network": "bsc-mainnet",
            "block": block,
            "measured_block_time_s": round(sec_per_block, 3),
            "blocks_per_year_used": int(blocks_per_year),
            "capital_usd": capital,
            "markets_ranked": ranked,
            "errors": [m for m in markets if "error" in m],
            "recommendation": (
                {
                    "best_supply_market": best["asset"],
                    "apy_pct": best["supply_apy_pct"],
                    "est_annual_yield_usd": round(capital * best["supply_apy_pct"] / 100, 2),
                }
                if best
                else None
            ),
            "rationale": (
                f"supplyRatePerBlock read on-chain from {len(ranked)} Venus core-pool "
                f"markets at block {block}. APY compounds the per-block rate using the "
                f"chain's measured block time ({sec_per_block:.3f}s over the last "
                f"{SAMPLE_SPAN} blocks) rather than a hard-coded constant, so the "
                f"figures stay correct across BSC block-time upgrades. Supply-side "
                f"yields only; borrowing costs and rewards emissions not included."
            ),
            "disclaimer": "Analytics only — not financial advice; no funds are moved.",
            "generated_at": int(time.time()),
            "compute_seconds": round(time.time() - started, 2),
            "operator": "AgentCensus (agentcensus.xyz)",
        }
    except Exception as e:
        report = {
            "type": "yield-scan/v1",
            "error": f"scan failed: {str(e)[:120]}",
            "generated_at": int(time.time()),
        }
    return json.dumps(report, separators=(",", ":"))


if __name__ == "__main__":
    import sys

    print(run_task(sys.argv[1] if len(sys.argv) > 1 else ""))
