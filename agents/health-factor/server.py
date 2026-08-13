"""
AgentCensus reference agent #1 — Health Factor Monitor (BSC testnet first).

Thin, analysis-first by design (v2 strategy): reads Venus Protocol positions
via RPC, computes account liquidity / health factor, and delivers a report
through the ERC-8183 job lifecycle. Read-only market logic — zero fund risk.

SDK surface used (bnbagent, verified against installed package):
  - ERC8183Config / ERC8183JobOps  — async provider-side job operations
  - funded_job_watcher             — signer-free loop firing on newly FUNDED jobs
  - NegotiationHandler             — single-round /negotiate quote endpoint
The HTTP layout mirrors the SDK's `examples/agent-server/` reference
(github.com/bnb-chain/bnbagent-sdk) so the AgentCensus prober and any
ERC-8183 client can talk to it: POST /erc8183/negotiate, GET /erc8183/health.

Deploy: see deploy/README.md (VPS + systemd + Caddy — NOT the 48h Bedrock
free tier, which dies before judging ends).
"""
from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass

from web3 import Web3

# --- Venus Protocol (BSC) -------------------------------------------------
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


def run_task(description: str) -> str:
    """Produce the ERC-8183 deliverable. The job description (or its parsed
    negotiation `task` field) carries the target account as JSON or a bare address."""
    account = None
    network = "mainnet" if os.environ.get("AGENT_NETWORK", "bsc-testnet").endswith("mainnet") else "testnet"
    try:
        payload = json.loads(description)
        # negotiation schema v1 wraps the task text
        task = payload.get("task", payload)
        if isinstance(task, str):
            task = json.loads(task) if task.strip().startswith("{") else {"account": task.strip()}
        account = task.get("account")
        network = task.get("network", network)
    except (json.JSONDecodeError, AttributeError, TypeError):
        if isinstance(description, str) and description.strip().startswith("0x"):
            account = description.strip()
    if not account:
        return json.dumps({"error": "no account provided; pass {'account': '0x...'} in the task"})
    report = check_health(account, network)
    return json.dumps({"type": "agentcensus/health-factor-report/v1", "report": asdict(report)})


def create_app():
    """FastAPI app exposing the standard ERC-8183 endpoints, mirroring the
    SDK's examples/agent-server. Requires env: AGENT_PRIVATE_KEY (or keystore
    vars per ERC8183Config), AGENT_NETWORK (bsc-testnet | bsc-mainnet)."""
    from fastapi import FastAPI, HTTPException, Request

    from bnbagent import ERC8183Client
    from bnbagent.erc8183.job_ops import ERC8183JobOps, funded_job_watcher
    from bnbagent.erc8183.negotiation import NegotiationHandler

    network = os.environ.get("AGENT_NETWORK", "bsc-testnet")
    service_price = os.environ.get("SERVICE_PRICE_WEI", str(10**16))  # 0.01 U default

    client = ERC8183Client(
        network=network,
        private_key=os.environ["AGENT_PRIVATE_KEY"],  # keystore flow preferred in prod — see deploy/README
    )
    ops = ERC8183JobOps(client)
    handler = NegotiationHandler.from_erc8183_client(client, service_price=service_price)

    async def on_funded(job) -> None:
        deliverable = run_task(job.description)
        await ops.submit_result(job.id, deliverable)

    @asynccontextmanager
    async def lifespan(_app):
        watcher = asyncio.create_task(funded_job_watcher(ops, on_funded))
        yield
        watcher.cancel()

    app = FastAPI(title="AgentCensus Health Factor Monitor", lifespan=lifespan)

    @app.get("/erc8183/health")
    async def health():
        return {"ok": True, "service": "agentcensus-health-factor", "network": network}

    @app.get("/erc8183/status")
    async def status():
        return {
            "service": "AgentCensus Health Factor Monitor",
            "price_wei": service_price,
            "network": network,
            "categories": ["health-factor"],
        }

    @app.post("/erc8183/negotiate")
    async def negotiate(request: Request):
        body = await request.json()
        try:
            result = handler.negotiate(body)
        except Exception as exc:  # rate limit / malformed — map to HTTP
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return result.to_dict()

    @app.get("/erc8183/job/{job_id}")
    async def job(job_id: int):
        return await ops.get_job(job_id)

    return app


if __name__ == "__main__":
    # Local smoke test without the ERC-8183 server: python server.py 0xACCOUNT [network]
    import sys

    if len(sys.argv) > 1:
        print(json.dumps(asdict(check_health(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "testnet")), indent=2))
    else:
        import uvicorn

        uvicorn.run(create_app(), host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
