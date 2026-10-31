from __future__ import annotations

import asyncio
import socket
from typing import Any

import httpx

from .config import Settings
from .xuse_client import (
    NetworkProbeResult,
    ReplyResult,
    configured_account_keys,
    probe_direct_egress,
    probe_network_route,
    send_approved_action,
    xuse_is_installed,
)


WORKER_VERSION = "4.0.0-macbook-xuse"
HALT_ERROR_MARKERS = ("captcha", "challenge", "login", "locked", "rate_limit", "rate limit", "verification")


async def run_x_reply_worker(settings: Settings) -> None:
    if len(settings.x_reply_worker_secret) < 32:
        return
    await asyncio.sleep(5)
    last_error: str | None = None
    while True:
        try:
            last_error, halt = await run_x_reply_iteration(settings, last_error=last_error)
            if halt:
                return
        except asyncio.CancelledError:
            raise
        except Exception as error:
            last_error = f"{type(error).__name__}: worker iteration failed"[:1000]
            await asyncio.sleep(max(60, settings.x_reply_worker_poll_seconds))
        else:
            await asyncio.sleep(settings.x_reply_worker_poll_seconds)


async def run_x_reply_iteration(settings: Settings, *, last_error: str | None = None) -> tuple[str | None, bool]:
    """Report one heartbeat and, only in send mode, execute at most one approved write."""
    direct_probe = await probe_direct_egress(settings.x_reply_ip_check_url)
    xuse_available = xuse_is_installed()
    configured_accounts = configured_account_keys(settings.x_use_home) if xuse_available else []
    probe_error = direct_probe.error_message if not direct_probe.ok else None
    payload: dict[str, Any] = {
        "executorId": settings.x_reply_executor_id,
        "executionMode": settings.x_reply_execution_mode,
        "workerVersion": WORKER_VERSION,
        "deviceLabel": settings.x_reply_device_label or socket.gethostname()[:120],
        "xUseAvailable": xuse_available,
        "configuredAccounts": configured_accounts,
        "currentEgressIp": direct_probe.egress_ip,
        "networkProbeStatus": "healthy" if direct_probe.ok else "error",
        "lastError": probe_error or last_error,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await _post_claim(settings, client, payload)
        if settings.x_reply_execution_mode != "send":
            if response.status_code != 204:
                return "Observe mode received a non-empty claim response and refused to execute it.", False
            return probe_error, False
        if response.status_code == 204:
            return probe_error, False
        response.raise_for_status()
        body = response.json()

        probe_request = body.get("probe")
        if isinstance(probe_request, dict):
            account_key = str(probe_request.get("accountKey") or "")
            if account_key not in configured_accounts:
                return "The candidate account is not configured locally; no job was claimed.", False
            route_probe = await probe_network_route(
                x_use_home=settings.x_use_home,
                account=account_key,
                network_mode=str(probe_request.get("networkMode") or ""),
                proxy_url=str(probe_request.get("proxyUrl") or "") or None,
                ip_check_url=settings.x_reply_ip_check_url,
            )
            if not route_probe.ok or not route_probe.egress_ip:
                return route_probe.error_message or "The fixed proxy route could not be verified.", _must_halt(route_probe.error_code, route_probe.error_message)
            verified_payload = dict(payload)
            verified_payload["networkVerification"] = {
                "jobId": probe_request.get("jobId"),
                "accountKey": account_key,
                "egressIp": route_probe.egress_ip,
            }
            response = await _post_claim(settings, client, verified_payload)
            if response.status_code == 204:
                return None, False
            response.raise_for_status()
            body = response.json()

        job = body.get("job")
        if not isinstance(job, dict):
            return "The claim endpoint returned neither a probe nor a job.", False
        result = await _execute_job(settings, client, job)
        return result.error_message, _must_halt(result.error_code, result.error_message)


async def _post_claim(settings: Settings, client: httpx.AsyncClient, payload: dict[str, Any]) -> httpx.Response:
    return await client.post(
        f"{settings.diy_site_url}/api/x-replies/worker/jobs/claim",
        headers={"Authorization": f"Bearer {settings.x_reply_worker_secret}"},
        json=payload,
    )


async def _execute_job(settings: Settings, client: httpx.AsyncClient, job: dict[str, Any]) -> ReplyResult:
    async def verify_route(egress_ip: str) -> tuple[bool, str | None]:
        try:
            response = await client.post(
                f"{settings.diy_site_url}/api/x-replies/worker/proxies/verify",
                headers={"Authorization": f"Bearer {settings.x_reply_worker_secret}"},
                json={
                    "executorId": settings.x_reply_executor_id,
                    "jobId": job["id"],
                    "accountKey": job["accountKey"],
                    "egressIp": egress_ip,
                },
            )
            if response.is_success:
                return True, None
            detail = response.json().get("error") if response.headers.get("content-type", "").startswith("application/json") else None
            return False, str(detail or f"Network verification failed with HTTP {response.status_code}.")[:1000]
        except Exception as error:
            return False, f"Network verification request failed: {type(error).__name__}"[:1000]

    try:
        result = await send_approved_action(
            x_use_home=settings.x_use_home,
            account=str(job["accountKey"]),
            action_type=str(job["actionType"]),
            tweet_url=str(job["targetPostUrl"]) if job.get("targetPostUrl") else None,
            text=str(job["postText"]),
            network_mode=str(job["networkMode"]),
            ip_check_url=settings.x_reply_ip_check_url,
            proxy_url=str(job["proxyUrl"]) if job.get("proxyUrl") else None,
            verify_route=verify_route,
        )
    except Exception as error:
        result = ReplyResult(status="failed", error_code=type(error).__name__[:100], error_message=f"{type(error).__name__}: local execution failed"[:1000])

    payload = {
        "executorId": settings.x_reply_executor_id,
        "status": result.status,
        "xUseDraftId": result.draft_id,
        "actionId": result.action_id,
        "resultUrl": result.result_url,
        "errorCode": result.error_code,
        "errorMessage": result.error_message,
        "egressIp": result.egress_ip,
    }
    # Report exactly once. If the connection dies after an X write, the claimed
    # task ages into uncertain and is never returned to the queue.
    response = await client.post(
        f"{settings.diy_site_url}/api/x-replies/worker/jobs/{job['id']}/complete",
        headers={"Authorization": f"Bearer {settings.x_reply_worker_secret}"},
        json=payload,
    )
    response.raise_for_status()
    return result


def _must_halt(error_code: str | None, error_message: str | None) -> bool:
    value = f"{error_code or ''} {error_message or ''}".lower()
    return any(marker in value for marker in HALT_ERROR_MARKERS)
