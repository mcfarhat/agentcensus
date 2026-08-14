"""Resume a partially-created loop-test job:  python resume_job.py <jobId>

Picks up wherever the job stalled:
  OPEN      -> fund(0), then wait for the agent's submit, then settle
  FUNDED    -> wait for submit, then settle
  SUBMITTED -> wait out the dispute window, then settle
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

from bnbagent.erc8183 import ERC8183Client, JobStatus
from bnbagent.wallets import EVMWalletProvider

load_dotenv(Path(__file__).resolve().parent / ".env")

NETWORK = os.environ.get("NETWORK", "bsc-testnet")
POLICY = os.environ.get("POLICY_ADDRESS", "0xd6A4217588F6B1F5657a92A3e94E6422Ad771cEa")
RPC = os.environ.get("RPC_URL", "https://data-seed-prebsc-1-s1.bnbchain.org:8545")
AGENT_URL = os.environ.get("AGENT_URL", "http://localhost:8003/erc8183")

job_id = int(sys.argv[1])
client = ERC8183Client(
    EVMWalletProvider(password="loop-test", private_key=os.environ["PRIVATE_KEY"], persist=False),
    network=NETWORK,
)


def dispute_window() -> int:
    r = requests.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": "eth_call",
                                 "params": [{"to": POLICY, "data": "0x117f5f92"}, "latest"]}, timeout=15)
    return int(r.json().get("result", "0x384"), 16)


job = client.get_job(job_id)
print(f"[resume] job {job_id} status={job.status.name}")

if job.status == JobStatus.OPEN:
    client.fund(job_id, 0)
    print("[resume] fund 0 -> FUNDED")
    job = client.get_job(job_id)

if job.status == JobStatus.FUNDED:
    print("[resume] waiting for the agent to submit (poll ~30s)...")
    deadline = time.time() + 15 * 60
    while time.time() < deadline:
        job = client.get_job(job_id)
        if job.status == JobStatus.SUBMITTED:
            break
        print(f"    status={job.status.name} — waiting...")
        time.sleep(20)

if job.status == JobStatus.SUBMITTED:
    print(f"[resume] SUBMITTED  deliverable_hash={job.deliverable.hex()}")
    try:
        resp = requests.get(f"{AGENT_URL}/job/{job_id}/response", timeout=10).json()
        import json as _json

        print(_json.dumps(resp, indent=2)[:1200])
    except Exception:
        pass
    window = dispute_window()
    elapsed = int(time.time()) - job.submitted_at if job.submitted_at else 0
    remaining = max(0, window - elapsed) + 60
    print(f"[resume] dispute window {window}s, elapsed {elapsed}s — waiting {remaining}s, then settling...")
    time.sleep(remaining)
    client.settle(job_id)
    job = client.get_job(job_id)

print(f"[resume] final status: {job.status.name}")
if job.status == JobStatus.COMPLETED:
    print(f"\nFULL HIRE LOOP COMPLETE for job {job_id} ✔")
