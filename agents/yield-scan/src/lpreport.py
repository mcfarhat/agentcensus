"""PancakeSwap LP report — impermanent loss + fee yield from live chain data.

Built for PancakeSwap liquidity providers: reads the WBNB/USDT v2 pool's
reserves, MEASURES real trading volume by summing actual Swap events over a
recent block window (no third-party volume APIs), extrapolates the LP fee APR,
and computes impermanent loss vs the caller's entry price. Read-only — no
funds are handled; the deliverable is the report, anchored on-chain per
ERC-8183.
"""
from __future__ import annotations

import json
import math
import re
import time

import requests

MAINNET_RPC = "https://bsc-dataseed.bnbchain.org"
# PancakeSwap v2 WBNB/USDT pair. token0 = USDT, token1 = WBNB (both 18 dec).
PAIR = "0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE"
GET_RESERVES = "0x0902f1ac"
SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822"

VOLUME_WINDOW_BLOCKS = 2000  # sampled window, extrapolated to 24h
LP_FEE_SHARE = 0.0017  # v2: 0.25% swap fee, 0.17% goes to LPs


def _rpc(method: str, params: list):
    r = requests.post(
        MAINNET_RPC,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        timeout=10,
    )
    r.raise_for_status()
    out = r.json()
    if "error" in out:
        raise RuntimeError(out["error"])
    return out["result"]


def _num(task: str, key: str) -> float | None:
    m = re.search(rf"{key}\s*[:=]?\s*(\d+(?:\.\d+)?)", task, re.IGNORECASE)
    return float(m.group(1)) if m else None


def run_lp_task(task_text: str) -> str:
    """PancakeSwap LP report. Task may set: entry=<price at deposit> capital=<usd>."""
    started = time.time()
    task = task_text or ""
    capital = _num(task, "capital") or 1000.0
    entry = _num(task, "entry")

    try:
        # --- pool state ---
        raw = _rpc("eth_call", [{"to": PAIR, "data": GET_RESERVES}, "latest"])
        w = raw[2:]
        reserve_usdt = int(w[0:64], 16) / 1e18
        reserve_wbnb = int(w[64:128], 16) / 1e18
        price = reserve_usdt / reserve_wbnb
        tvl_usd = 2 * reserve_usdt

        latest = _rpc("eth_getBlockByNumber", ["latest", False])
        n = int(latest["number"], 16)
        t1 = int(latest["timestamp"], 16)
        older = _rpc("eth_getBlockByNumber", [hex(n - VOLUME_WINDOW_BLOCKS), False])
        t0 = int(older["timestamp"], 16)
        window_seconds = t1 - t0

        # --- measured volume: sum the USDT leg of every real Swap in the window ---
        logs = _rpc(
            "eth_getLogs",
            [{
                "address": PAIR,
                "fromBlock": hex(n - VOLUME_WINDOW_BLOCKS),
                "toBlock": "latest",
                "topics": [SWAP_TOPIC],
            }],
        )
        vol_usdt = 0.0
        for lg in logs:
            d = lg["data"][2:]
            amount0_in = int(d[0:64], 16) / 1e18     # USDT in
            amount0_out = int(d[128:192], 16) / 1e18  # USDT out
            vol_usdt += amount0_in + amount0_out

        vol_24h = vol_usdt * (86400 / window_seconds) if window_seconds > 0 else 0.0
        fee_apr_pct = (vol_24h * LP_FEE_SHARE * 365 / tvl_usd * 100) if tvl_usd > 0 else 0.0

        # --- impermanent loss vs entry price (if provided) ---
        il = None
        if entry and entry > 0:
            r_ratio = price / entry
            il_frac = 2 * math.sqrt(r_ratio) / (1 + r_ratio) - 1  # ≤ 0
            il = {
                "entry_price": entry,
                "current_price": round(price, 2),
                "price_change_pct": round((r_ratio - 1) * 100, 2),
                "impermanent_loss_pct": round(il_frac * 100, 3),
                "il_usd_on_capital": round(abs(il_frac) * capital, 2),
            }

        breakeven_days = (
            round(abs(il["impermanent_loss_pct"]) / (fee_apr_pct / 365), 1)
            if il and fee_apr_pct > 0
            else None
        )

        report = {
            "type": "pancakeswap-lp-report/v1",
            "pool": "WBNB/USDT (PancakeSwap v2)",
            "pair_address": PAIR,
            "network": "bsc-mainnet",
            "block": n,
            "pool_state": {
                "reserve_usdt": round(reserve_usdt, 0),
                "reserve_wbnb": round(reserve_wbnb, 2),
                "price_usdt_per_bnb": round(price, 2),
                "tvl_usd": round(tvl_usd, 0),
            },
            "measured_volume": {
                "window_blocks": VOLUME_WINDOW_BLOCKS,
                "window_seconds": window_seconds,
                "swaps_counted": len(logs),
                "volume_usdt_in_window": round(vol_usdt, 0),
                "volume_24h_extrapolated_usd": round(vol_24h, 0),
                "method": "sum of USDT legs of real Swap events on the pair — no external volume APIs",
            },
            "lp_economics": {
                "capital_usd": capital,
                "lp_fee_share_of_volume": LP_FEE_SHARE,
                "fee_apr_pct": round(fee_apr_pct, 3),
                "est_daily_fees_usd_on_capital": round(capital * fee_apr_pct / 100 / 365, 4),
            },
            "impermanent_loss": il or "provide entry=<price at deposit> for IL analysis",
            "il_fee_breakeven_days": breakeven_days,
            "rationale": (
                f"TVL and price read from pool reserves at block {n}. Volume is "
                f"measured, not quoted: {len(logs)} real Swap events over the last "
                f"{VOLUME_WINDOW_BLOCKS} blocks ({window_seconds}s), extrapolated to "
                f"24h. Fee APR assumes the v2 LP share ({LP_FEE_SHARE*100:.2f}% of "
                f"volume) accrues pro-rata to the pool. IL uses the constant-product "
                f"formula 2*sqrt(r)/(1+r)-1 against your entry price"
                + (f"; at current prices fees recover the IL in ~{breakeven_days} days." if breakeven_days else ".")
            ),
            "disclaimer": "Analytics only — not financial advice; no funds are moved.",
            "generated_at": int(time.time()),
            "compute_seconds": round(time.time() - started, 2),
            "operator": "AgentCensus (agentcensus.xyz)",
        }
    except Exception as e:
        report = {
            "type": "pancakeswap-lp-report/v1",
            "error": f"lp scan failed: {str(e)[:120]}",
            "generated_at": int(time.time()),
        }
    return json.dumps(report, separators=(",", ":"))


if __name__ == "__main__":
    import sys

    print(run_lp_task(sys.argv[1] if len(sys.argv) > 1 else "entry=600 capital=1000"))
