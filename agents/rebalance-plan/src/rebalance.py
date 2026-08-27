"""AgentCensus Rebalance Planner — deterministic portfolio-rebalancing plan.

Read-only rebalancing analytics: reads the live BNB/USDT price from PancakeSwap
v2 reserves on BSC mainnet, values a BNB+USDT portfolio, compares it to a
target allocation, and emits the exact trade required to rebalance (with a
drift band so it never recommends churn). No funds are handled, no orders are
placed — the deliverable is the plan itself, anchored on-chain per ERC-8183.
"""
from __future__ import annotations

import json
import re
import time

import requests

MAINNET_RPC = "https://bsc-dataseed.bnbchain.org"
# PancakeSwap v2 WBNB/USDT pair. token0 = USDT, token1 = WBNB (both 18 dec).
PAIR = "0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE"
GET_RESERVES = "0x0902f1ac"

DEFAULT_BNB = 1.0
DEFAULT_USDT = 600.0
DEFAULT_TARGET_BNB_PCT = 50.0
DEFAULT_BAND_PCT = 2.0  # rebalance only if |drift| exceeds this


def _live_bnb_price() -> tuple[float | None, int | None]:
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
        reserve_usdt = int(w[0:64], 16)
        reserve_wbnb = int(w[64:128], 16)
        if reserve_wbnb == 0:
            return None, None
        return reserve_usdt / reserve_wbnb, block
    except Exception:
        return None, None


def _num(task: str, key: str) -> float | None:
    m = re.search(rf"{key}\s*[:=]?\s*(\d+(?:\.\d+)?)", task, re.IGNORECASE)
    return float(m.group(1)) if m else None


def run_task(task_text: str) -> str:
    """Build a rebalance plan.

    Task may override: bnb=<qty> usdt=<qty> target_bnb=<pct> band=<pct> price=<usdt>.
    """
    started = time.time()
    task = task_text or ""
    price, block = _live_bnb_price()
    source = "pancakeswap_v2_reserves@bsc-mainnet"
    if price is None:
        price = _num(task, "price") or 600.0
        block = None
        source = "fallback_task_or_default"

    bnb_qty = _num(task, "bnb") if _num(task, "bnb") is not None else DEFAULT_BNB
    usdt_qty = _num(task, "usdt") if _num(task, "usdt") is not None else DEFAULT_USDT
    target_bnb_pct = _num(task, "target_bnb") or DEFAULT_TARGET_BNB_PCT
    target_bnb_pct = max(0.0, min(100.0, target_bnb_pct))
    band = _num(task, "band") or DEFAULT_BAND_PCT
    band = max(0.1, min(20.0, band))

    bnb_value = bnb_qty * price
    total = bnb_value + usdt_qty
    cur_bnb_pct = (bnb_value / total * 100.0) if total > 0 else 0.0
    drift = cur_bnb_pct - target_bnb_pct

    target_bnb_value = total * target_bnb_pct / 100.0
    delta_usdt = bnb_value - target_bnb_value  # >0: overweight BNB → sell
    delta_bnb = delta_usdt / price if price else 0.0

    if abs(drift) <= band:
        action = {
            "action": "HOLD",
            "reason": f"Drift {drift:+.2f}pp is within the ±{band:.1f}pp band — trading now would only pay fees.",
        }
    elif delta_usdt > 0:
        action = {
            "action": "SELL_BNB",
            "qty_bnb": round(abs(delta_bnb), 5),
            "proceeds_usdt": round(abs(delta_usdt), 2),
            "reason": f"BNB is {drift:+.2f}pp overweight vs the {target_bnb_pct:.0f}% target.",
        }
    else:
        action = {
            "action": "BUY_BNB",
            "qty_bnb": round(abs(delta_bnb), 5),
            "cost_usdt": round(abs(delta_usdt), 2),
            "reason": f"BNB is {drift:+.2f}pp underweight vs the {target_bnb_pct:.0f}% target.",
        }

    report = {
        "type": "rebalance-plan/v1",
        "pair": "BNB/USDT",
        "live_price": round(price, 2),
        "price_source": source,
        "price_block": block,
        "portfolio": {
            "bnb_qty": bnb_qty,
            "usdt_qty": usdt_qty,
            "bnb_value_usdt": round(bnb_value, 2),
            "total_value_usdt": round(total, 2),
        },
        "allocation": {
            "current_bnb_pct": round(cur_bnb_pct, 2),
            "target_bnb_pct": target_bnb_pct,
            "drift_pp": round(drift, 2),
            "band_pp": band,
        },
        "plan": action,
        "post_trade_allocation_bnb_pct": target_bnb_pct if abs(drift) > band else round(cur_bnb_pct, 2),
        "rationale": (
            f"Portfolio valued at live PancakeSwap price {round(price, 2)} USDT/BNB "
            f"(block {block}). Current BNB weight {cur_bnb_pct:.2f}% vs target "
            f"{target_bnb_pct:.0f}%. A ±{band:.1f}pp no-trade band suppresses "
            f"fee-burning churn; outside the band the plan trades back to target "
            f"in a single swap."
        ),
        "disclaimer": "Analytics only — not financial advice; no orders are placed.",
        "generated_at": int(time.time()),
        "compute_seconds": round(time.time() - started, 2),
        "operator": "AgentCensus (agentcensus.xyz)",
    }
    return json.dumps(report, separators=(",", ":"))


if __name__ == "__main__":
    import sys

    print(run_task(sys.argv[1] if len(sys.argv) > 1 else ""))
