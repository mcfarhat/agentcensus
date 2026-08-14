"""Full ERC-8183 hire loop against the AgentCensus health-factor agent — zero budget.

The golden path, end to end, with NO U tokens required (fund(0) moves nothing):

  1. POST /erc8183/negotiate on the running agent  → signed quote
  2. build_job_description(quote)                  → canonical on-chain anchor
  3. createJob → registerJob(policy) → setBudget(0) → fund(0)
  4. the agent's funded-poll loop picks the job up, runs the Venus health
     check, uploads the deliverable manifest, calls submit()
  5. this script polls until SUBMITTED and prints the deliverable
  6. after the dispute window (testnet: 24h), settle with:
       python settle_job.py <jobId>        (or packages/hire: cli settle)

Prereqs:
  - agent running locally:  cd ../health-factor && python scripts/run_agent.py
  - .env in this folder (copy .env.example): CLIENT PRIVATE_KEY (your funded
    buyer test wallet, tBNB for gas), PROVIDER_ADDRESS (the AGENT's wallet
    address — printed by the agent's /erc8183/status endpoint).
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

from bnbagent.erc8183 import ERC8183Client, JobStatus
from bnbagent.erc8183.negotiation import build_job_description
from bnbagent.wallets import EVMWalletProvider

load_dotenv(Path(__file__).resolve().parent / ".env")

NETWORK = os.environ.get("NETWORK", "bsc-testnet")
# The router's CURRENTLY WHITELISTED policy (testnet policies rotated after the
# SDK release — the SDK's preset 0x4f4678... is de-whitelisted and registerJob
# reverts with PolicyNotWhitelisted 0xc94463e3). Verified on-chain 2026-08-15;
# this one has a 15-minute dispute window, so the loop settles in one run.
POLICY = os.environ.get("POLICY_ADDRESS", "0xd6A4217588F6B1F5657a92A3e94E6422Ad771cEa")
RPC = os.environ.get("RPC_URL", "https://data-seed-prebsc-1-s1.bnbchain.org:8545")


def eth_call(to: str, data: str) -> str:
    r = requests.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": "eth_call",
                                 "params": [{"to": to, "data": data}, "latest"]}, timeout=15)
    return r.json().get("result", "0x")
AGENT_URL = os.environ.get("AGENT_URL", "http://localhost:8003/erc8183")
CLIENT_PK = os.environ["PRIVATE_KEY"]
PROVIDER = os.environ.get("PROVIDER_ADDRESS", "")


def main() -> None:
    client = ERC8183Client(
        EVMWalletProvider(password="loop-test", private_key=CLIENT_PK, persist=False),
        network=NETWORK,
    )
    provider = PROVIDER
    if not provider:
        status = requests.get(f"{AGENT_URL}/status", timeout=10).json()
        provider = status["agent_address"]
        print(f"[0] provider from /status: {provider}")
    # The account whose Venus position the agent analyzes — resolved AFTER the
    # provider is known so the default is never empty (bug in the first run:
    # empty account -> agent returned its graceful error as the deliverable).
    target_account = os.environ.get("TARGET_ACCOUNT") or provider

    # -- 1. negotiate ------------------------------------------------------
    task = json.dumps({"account": target_account, "network": "testnet"})
    quote = requests.post(
        f"{AGENT_URL}/negotiate",
        json={
            "task_description": task,
            "terms": {
                "deliverables": "JSON health-factor report for the given account",
                "quality_standards": "Live Venus comptroller data at current block",
            },
        },
        timeout=20,
    )
    quote.raise_for_status()
    quote_dict = quote.json()
    print(f"[1] negotiated: accepted={quote_dict.get('response', {}).get('accepted')}")

    # -- 2. canonical description -----------------------------------------
    description = build_job_description(quote_dict)
    print(f"[2] description built ({len(description)} bytes)")

    # -- 3. create → register → budget 0 → fund 0 -------------------------
    window = client.policy.dispute_window()
    expired_at = int(time.time()) + int(window) + 45 * 60  # window + 45 min to submit
    res = client.create_job(provider=provider, expired_at=expired_at, description=description)
    job_id = res["jobId"]
    print(f"[3a] createJob jobId={job_id} tx={res.get('txHash', '')}")
    client.register_job(job_id, policy=POLICY)
    print(f"[3b] registerJob -> whitelisted policy {POLICY[:10]}...")
    client.set_budget(job_id, 0)
    print("[3c] setBudget 0 (zero-price test)")
    client.fund(job_id, 0)
    print("[3d] fund 0 -> FUNDED (no tokens moved)")

    # -- 4/5. wait for the agent to submit ---------------------------------
    print("[4] waiting for the agent's poll loop to pick it up (cadence ~30s)...")
    deadline = time.time() + 15 * 60
    while time.time() < deadline:
        job = client.get_job(job_id)
        if job.status == JobStatus.SUBMITTED:
            print(f"[5] SUBMITTED  deliverable_hash={job.deliverable.hex()}")
            try:
                resp = requests.get(f"{AGENT_URL}/job/{job_id}/response", timeout=10).json()
                print("[5] deliverable content:")
                print(json.dumps(resp, indent=2)[:1500])
            except Exception as exc:  # deliverable fetch is best-effort here
                print(f"[5] (couldn't fetch deliverable content: {exc})")
            # The registered policy's window (NOT the SDK-default policy's) governs settle.
            real_window = int(eth_call(POLICY, "0x117f5f92"), 16)  # disputeWindow()
            wait_s = real_window + 60
            print(f"[6] dispute window on registered policy: {real_window}s — waiting {wait_s}s, then settling...")
            time.sleep(wait_s)
            client.settle(job_id)
            final = client.get_job(job_id)
            print(f"[7] settle -> {final.status.name}")
            if final.status == JobStatus.COMPLETED:
                print(f"\nFULL HIRE LOOP COMPLETE for job {job_id}:")
                print("  negotiate -> createJob -> registerJob -> fund(0) -> agent submit -> settle ✔")
            else:
                print(f"\n[!] unexpected final status {final.status.name} — settle manually: python settle_job.py {job_id}")
            return
        print(f"    status={job.status.name} — waiting...")
        time.sleep(20)
    print("[!] timed out waiting for submission — check the agent server logs.")
    sys.exit(1)


if __name__ == "__main__":
    main()
