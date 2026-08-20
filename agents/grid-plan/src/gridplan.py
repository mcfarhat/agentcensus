"""AgentCensus Grid Planner — deterministic grid-trading plan generator.

Read-only trading analytics: reads the live BNB/USDT price from PancakeSwap v2
reserves on BSC mainnet and emits a structured grid-trading plan (levels,
allocations, rationale). No funds are handled, no orders are placed — the
deliverable is the plan itself, anchored on-chain per ERC-8183.
"""
from __future__ import annotations

import json
import re
import time

import requests

MAINNET_RPC = "https://bsc-dataseed.bnbchain.org"
# PancakeSwap v2 WBNB/USDT pair. token0 = USDT (0x55d3...), token1 = WBNB (0xbb4C...).
PAIR = "0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE"
GET_RESERVES = "0x0902f1ac"

DEFAULT_LEVELS = 7
DEFAULT_SPAN_PCT = 8.0


def _live_bnb_price() -> tuple[float | None, int | None]:
    """Return (BNB price in USDT, block number) from PancakeSwap v2 reserves."""
    try:
        def call(method: str, params: list) -> str:
            r = requests.post(
                MAINNET_RPC,
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                timeout=8,
            )
            r.raise_for_status()
            return r.json()["result"]

        raw = call("eth_call", [{"to": PAIR, "data": GET_RESERVES}, "latest"])
        block = int(call("eth_blockNumber", []), 16)
        w = raw[2:]
        reserve_usdt = int(w[0:64], 16)      # token0 = USDT (18 dec)
        reserve_wbnb = int(w[64:128], 16)    # token1 = WBNB (18 dec)
        if reserve_wbnb == 0:
            return None, None
        return reserve_usdt / reserve_wbnb, block
    except Exception:
        return None, None


def _extract_number(task: str, key: str) -> float | None:
    m = re.search(rf"{key}\s*[:=]?\s*(\d+(?:\.\d+)?)", task, re.IGNORECASE)
    return float(m.group(1)) if m else None


def run_task(task_text: str) -> str:
    """Build a grid plan. Task may override: center=<price> levels=<n> span=<pct> capital=<usdt>."""
    started = time.time()
    price, block = _live_bnb_price()
    source = "pancakeswap_v2_reserves@bsc-mainnet"
    if price is None:
        price = _extract_number(task_text, "center") or 600.0
        block = None
        source = "fallback_task_or_default"

    center = _extract_number(task_text, "center") or round(price, 2)
    levels = int(_extract_number(task_text, "levels") or DEFAULT_LEVELS)
    levels = max(3, min(15, levels))
    span = _extract_number(task_text, "span") or DEFAULT_SPAN_PCT
    span = max(2.0, min(25.0, span))
    capital = _extract_number(task_text, "capital") or 1000.0

    # Geometric grid centered on `center`, +/- span%.
    lo, hi = center * (1 - span / 100), center * (1 + span / 100)
    ratio = (hi / lo) ** (1 / (levels - 1))
    per_level = round(capital / levels, 2)
    grid = []
    for i in range(levels):
        p = lo * (ratio ** i)
        side = "BUY" if p < center else ("SELL" if p > center else "PIVOT")
        grid.append({
            "level": i + 1,
            "price": round(p, 2),
            "side": side,
            "allocation_usdt": per_level,
            "qty_bnb": round(per_level / p, 5),
        })

    report = {
        "type": "grid-trading-plan/v1",
        "pair": "BNB/USDT",
        "live_price": round(price, 2),
        "price_source": source,
        "price_block": block,
        "center": center,
        "span_pct": span,
        "levels": levels,
        "capital_usdt": capital,
        "grid": grid,
        "step_pct": round((ratio - 1) * 100, 3),
        "rationale": (
            f"Geometric {levels}-level grid across ±{span}% of {center} USDT. "
            f"Buys ladder below the pivot, sells above; each level commits "
            f"{per_level} USDT. Expected round-trip profit per filled pair ≈ "
            f"{round((ratio - 1) * 100, 2)}% minus fees. Recompute the grid when "
            f"price exits the band."
        ),
        "disclaimer": "Analytics only — not financial advice; no orders are placed.",
        "generated_at": int(time.time()),
        "compute_seconds": round(time.time() - started, 2),
        "operator": "AgentCensus (agentcensus.xyz)",
    }
    return json.dumps(report, separators=(",", ":"))
