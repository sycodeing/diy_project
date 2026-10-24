from __future__ import annotations

import asyncio
import socket
from typing import Any

import httpx

from .config import Settings
from .xuse_client import configured_account_keys, send_approved_action, xuse_is_installed


async def run_x_reply_worker(settings: Settings) -> None:
    if len(settings.x_reply_worker_secret) < 32:
        return
    worker_id = f"{socket.gethostname()}-x-use-publisher"[:120]
    await asyncio.sleep(5)
    while True:
        accounts = configured_account_keys(settings.x_use_home)
        available = xuse_is_installed()
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    f"{settings.diy_site_url}/api/x-replies/worker/jobs/claim",
                    headers={"Authorization": f"Bearer {settings.x_reply_worker_secret}"},
                    json={
                        "workerId": worker_id,
                        "xUseAvailable": available,
                        "configuredAccounts": accounts,
                        "version": "2.0.0",
                        "errorMessage": None if available else "x-use-mcp is not installed.",
                    },
                )
            if response.status_code == 204:
                await asyncio.sleep(settings.x_reply_worker_poll_seconds)
                continue
            response.raise_for_status()
            job = response.json()["job"]
            await _execute_job(settings, worker_id, job)
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(max(60, settings.x_reply_worker_poll_seconds))
        else:
            await asyncio.sleep(2)


async def _execute_job(settings: Settings, worker_id: str, job: dict[str, Any]) -> None:
    target_post_url = job.get("targetPostUrl")
    result = await send_approved_action(
        x_use_home=settings.x_use_home,
        account=str(job["accountKey"]),
        action_type=str(job["actionType"]),
        tweet_url=str(target_post_url) if target_post_url else None,
        text=str(job["postText"]),
    )
    payload = {
        "workerId": worker_id,
        "status": result.status,
        "xUseDraftId": result.draft_id,
        "actionId": result.action_id,
        "resultUrl": result.result_url,
        "errorCode": result.error_code,
        "errorMessage": result.error_message,
    }
    # This report is intentionally attempted once. If the network dies after
    # an X write, the claimed job ages into "uncertain" instead of being resent.
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{settings.diy_site_url}/api/x-replies/worker/jobs/{job['id']}/complete",
            headers={"Authorization": f"Bearer {settings.x_reply_worker_secret}"},
            json=payload,
        )
    response.raise_for_status()
