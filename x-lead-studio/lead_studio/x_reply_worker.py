from __future__ import annotations

import asyncio
import socket
from typing import Any

import httpx

from .bitbrowser_client import BitBrowserClient, PublishResult, publish_in_attached_window
from .config import Settings


async def run_x_reply_worker(settings: Settings) -> None:
    if len(settings.x_reply_worker_secret) < 32:
        return
    worker_id = f"{socket.gethostname()}-bitbrowser-publisher"[:120]
    bitbrowser = BitBrowserClient(settings.bitbrowser_api_url)
    await asyncio.sleep(5)
    while True:
        available = await bitbrowser.health()
        windows = []
        error_message = None
        if available:
            try:
                windows = await bitbrowser.list_windows()
            except Exception as error:
                available = False
                error_message = f"{type(error).__name__}: {error}"[:1000]
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    f"{settings.diy_site_url}/api/x-replies/worker/jobs/claim",
                    headers={"Authorization": f"Bearer {settings.x_reply_worker_secret}"},
                    json={
                        "workerId": worker_id,
                        "bitbrowserAvailable": available,
                        "bitbrowserVersion": "7.2-compatible",
                        "windows": [{"id": item.id, "name": item.name, "seq": item.seq, "status": item.status} for item in windows],
                        "version": "3.0.0",
                        "errorMessage": error_message if not available else None,
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
    bitbrowser = BitBrowserClient(settings.bitbrowser_api_url)

    def verify_proxy(egress_ip: str) -> tuple[bool, str | None]:
        try:
            with httpx.Client(timeout=30) as client:
                response = client.post(
                    f"{settings.diy_site_url}/api/x-replies/worker/proxies/verify",
                    headers={"Authorization": f"Bearer {settings.x_reply_worker_secret}"},
                    json={
                        "workerId": worker_id,
                        "jobId": job["id"],
                        "accountKey": job["accountKey"],
                        "egressIp": egress_ip,
                    },
                )
            if response.is_success:
                return True, None
            detail = response.json().get("error") if response.headers.get("content-type", "").startswith("application/json") else None
            return False, str(detail or f"Proxy verification failed with HTTP {response.status_code}.")[:1000]
        except Exception as error:
            return False, f"Proxy verification request failed: {type(error).__name__}"[:1000]

    try:
        await bitbrowser.apply_proxy(str(job["bitbrowserWindowId"]), str(job["proxyUrl"]))
        open_data = await bitbrowser.open_window(str(job["bitbrowserWindowId"]))
        result = await asyncio.to_thread(
            publish_in_attached_window,
            open_data,
            str(job["actionType"]),
            str(target_post_url) if target_post_url else None,
            str(job["postText"]),
            verify_proxy,
        )
    except Exception as error:
        result = PublishResult(status="failed", error_code=type(error).__name__[:100], error_message=str(error)[:1000])
    payload = {
        "workerId": worker_id,
        "status": result.status,
        "xUseDraftId": None,
        "actionId": None,
        "resultUrl": result.result_url,
        "errorCode": result.error_code,
        "errorMessage": result.error_message,
        "egressIp": result.egress_ip,
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
