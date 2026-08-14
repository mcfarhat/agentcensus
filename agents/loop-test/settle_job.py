"""Settle a specific job after the dispute window: python settle_job.py <jobId>"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from bnbagent.erc8183 import ERC8183Client, JobStatus
from bnbagent.wallets import EVMWalletProvider

load_dotenv(Path(__file__).resolve().parent / ".env")

job_id = int(sys.argv[1])
client = ERC8183Client(
    EVMWalletProvider(password="loop-test", private_key=os.environ["PRIVATE_KEY"], persist=False),
    network=os.environ.get("NETWORK", "bsc-testnet"),
)
client.settle(job_id)
job = client.get_job(job_id)
print(f"job {job_id}: {job.status.name}")
assert job.status == JobStatus.COMPLETED, "expected COMPLETED"
print("Full hire loop complete: negotiate -> create -> fund -> submit -> settle ✔")
