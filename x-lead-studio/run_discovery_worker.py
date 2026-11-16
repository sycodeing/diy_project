"""Run only the X lead-discovery queue worker, without reply or auto-collection loops."""

from __future__ import annotations

import asyncio

from lead_studio.config import Settings
from lead_studio.x_lead_worker import run_x_lead_worker


if __name__ == "__main__":
    settings = Settings()
    if not settings.x_lead_worker_enabled or len(settings.x_lead_worker_secret) < 32:
        raise SystemExit("X lead discovery worker is not configured")
    asyncio.run(run_x_lead_worker(settings))
