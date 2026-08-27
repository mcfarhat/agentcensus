"""AgentCensus Yield Scanner — ERC-8183 provider agent (yield category).

Same service glue as the health-factor agent; the on_job handler builds a
yield plan from live PancakeSwap data (see yieldscan.py).

Run:  python scripts/run_agent.py     (from agents/yield-scan/)
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

env_file = os.path.basename(os.environ.get("ENV_FILE", ".env"))
load_dotenv(Path(__file__).resolve().parent.parent / env_file)

from bnbagent.erc8183.config import ERC8183Config
from bnbagent.erc8183.negotiation import parse_job_description
from bnbagent.storage import LocalStorageProvider

from erc8183_server import create_erc8183_app
from lpreport import run_lp_task
from yieldscan import run_task

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("agentcensus.yield-scan")

_storage = LocalStorageProvider.from_env()
config = ERC8183Config.from_env(storage=_storage)
PORT = int(os.getenv("PORT", "8007"))


def on_job(job: dict) -> str:
    """Handle a funded job: extract the task text, build the grid plan."""
    description = job.get("description", "") or ""
    task_text = description
    try:
        parsed = parse_job_description(description)
        t = parsed.get("task") if isinstance(parsed, dict) else getattr(parsed, "task", None)
        if t:
            task_text = t
    except Exception:
        pass
    logger.info(f"[on_job] job #{job.get('jobId') or job.get('id')}: task={task_text[:120]!r}")
    low = task_text.lower()
    if any(k in low for k in ("lp", "liquidity", "impermanent", "pancake")):
        return run_lp_task(task_text)
    return run_task(task_text)


app = create_erc8183_app(config, on_job=on_job)


@app.get("/")
async def root():
    return {
        "service": "AgentCensus Yield Scanner",
        "categories": ["yield", "lp-analytics"],
        "erc8183": "/erc8183y",
        "operator": "AgentCensus (agentcensus.xyz)",
    }
