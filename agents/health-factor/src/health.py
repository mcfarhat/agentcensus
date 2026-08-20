"""Venus Protocol health-factor analysis — the agent's actual skill.

Read-only market logic: computes account liquidity / shortfall via the
Venus Comptroller and returns a structured report. Zero fund risk.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass

from web3 import Web3

# Comptroller getAccountLiquidity returns (error, liquidity, shortfall), USD 1e18.
VENUS_COMPTROLLER = {
    "mainnet": "0xfD36E2c2a6789Db23113685031d7F16329158384",
    "testnet": "0x94d1820b2D1c7c7452A163983Dc888CEC546b77D",
}
COMPTROLLER_ABI = json.loads(
    """[
  {"name":"getAccountLiquidity","type":"function","stateMutability":"view",
   "inputs":[{"name":"account","type":"address"}],
   "outputs":[{"type":"uint256"},{"type":"uint256"},{"type":"uint256"}]},
  {"name":"getAssetsIn","type":"function","stateMutability":"view",
   "inputs":[{"name":"account","type":"address"}],
   "outputs":[{"type":"address[]"}]}
]"""
)

RPCS = {
    "mainnet": os.environ.get("BSC_MAINNET_RPC", "https://bsc-rpc.publicnode.com"),
    "testnet": os.environ.get("BSC_TESTNET_RPC", "https://bsc-testnet-rpc.publicnode.com"),
}


@dataclass
class HealthReport:
    account: str
    network: str
    block: int
    markets_entered: int
    liquidity_usd: float  # borrow headroom, USD
    shortfall_usd: float  # >0 means liquidatable NOW
    status: str  # HEALTHY | AT_RISK | LIQUIDATABLE
    recommendation: str


def check_health(account: str, network: str = "testnet", at_risk_threshold_usd: float = 50.0) -> HealthReport:
    w3 = Web3(Web3.HTTPProvider(RPCS[network]))
    comptroller = w3.eth.contract(
        address=Web3.to_checksum_address(VENUS_COMPTROLLER[network]), abi=COMPTROLLER_ABI
    )
    acct = Web3.to_checksum_address(account)
    err, liquidity, shortfall = comptroller.functions.getAccountLiquidity(acct).call()
    if err != 0:
        raise RuntimeError(f"comptroller error {err}")
    markets = comptroller.functions.getAssetsIn(acct).call()
    liq_usd = liquidity / 1e18
    short_usd = shortfall / 1e18

    if short_usd > 0:
        status, rec = "LIQUIDATABLE", "Repay debt or add collateral IMMEDIATELY - position can be liquidated."
    elif liq_usd < at_risk_threshold_usd:
        status, rec = "AT_RISK", f"Borrow headroom below ${at_risk_threshold_usd:.0f} - repay or add collateral soon."
    else:
        status, rec = "HEALTHY", "No action needed. Re-check on your alert cadence."

    return HealthReport(
        account=acct,
        network=network,
        block=w3.eth.block_number,
        markets_entered=len(markets),
        liquidity_usd=round(liq_usd, 2),
        shortfall_usd=round(short_usd, 2),
        status=status,
        recommendation=rec,
    )


def extract_account(task_text: str) -> tuple[str | None, str]:
    """Pull the target account (+optional network) out of free-form task text.

    Accepts: bare 0x address, or JSON like {"account": "0x...", "network": "testnet"}.
    """
    network = "testnet" if os.environ.get("NETWORK", "bsc-testnet").endswith("testnet") else "mainnet"
    text = (task_text or "").strip()
    if text.startswith("{"):
        try:
            payload = json.loads(text)
            if payload.get("account"):
                return payload.get("account"), payload.get("network", network)
            # No top-level account key — fall through and scan the raw text
            # (negotiation envelopes carry the address inside the task string).
        except json.JSONDecodeError:
            pass
    # scan for a 0x-address token anywhere in the text
    for token in text.replace(",", " ").replace('"', " ").split():
        if token.startswith("0x") and len(token) == 42:
            return token, network
    return None, network


def run_task(task_text: str) -> str:
    """Produce the deliverable content for a job's task text."""
    account, network = extract_account(task_text)
    if not account:
        # Generic hires (e.g. one-click demo jobs) carry no address — fall back
        # to a configured demo account, else the agent's own wallet address.
        account = os.environ.get("TARGET_ACCOUNT") or os.environ.get("WALLET_ADDRESS")
    if not account:
        try:
            from eth_account import Account

            key = os.environ.get("PRIVATE_KEY", "")
            if key:
                account = Account.from_key(key if key.startswith("0x") else "0x" + key).address
        except Exception:
            pass
    if not account:
        return json.dumps(
            {"error": "no account found in task; pass a 0x address or {\"account\": \"0x...\"}"}
        )
    report = check_health(account, network)
    return json.dumps({"type": "agentcensus/health-factor-report/v1", "report": asdict(report)}, indent=2)


if __name__ == "__main__":
    import sys

    print(run_task(sys.argv[1] if len(sys.argv) > 1 else ""))
