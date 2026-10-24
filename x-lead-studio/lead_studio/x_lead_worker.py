from __future__ import annotations

import asyncio
import json
import socket
from typing import Any

import httpx

from .apify import collect_apify_search
from .config import CREDENTIAL_PATH, Settings
from .discovery import collect_search
from .targeting import SEARCH_SEGMENTS


async def run_x_lead_worker(settings: Settings) -> None:
    if not settings.x_lead_worker_enabled or len(settings.x_lead_worker_secret) < 32:
        return
    provider = "apify" if settings.apify_api_token else "x-cookie"
    worker_id = f"{socket.gethostname()}-pet-lead-{provider}"[:120]
    headers = {"Authorization": f"Bearer {settings.x_lead_worker_secret}"}
    async with httpx.AsyncClient(timeout=120) as client:
        while True:
            try:
                response = await client.post(
                    f"{settings.diy_site_url}/api/x-leads/worker/jobs/claim",
                    headers=headers,
                    json={
                        "workerId": worker_id,
                        "cookieConfigured": bool(settings.apify_api_token) or CREDENTIAL_PATH.exists(),
                        "version": "1.0.0",
                    },
                )
                if response.status_code == 204:
                    await asyncio.sleep(settings.x_lead_worker_poll_seconds)
                    continue
                response.raise_for_status()
                job = response.json().get("job")
                if job:
                    await _execute_job(client, headers, settings, worker_id, job)
            except asyncio.CancelledError:
                raise
            except Exception:
                await asyncio.sleep(max(60, settings.x_lead_worker_poll_seconds))


async def _execute_job(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    settings: Settings,
    worker_id: str,
    job: dict[str, Any],
) -> None:
    received_count = 0
    candidates: dict[str, dict[str, Any]] = {}
    status = "completed"
    error_code = None
    error_message = None
    try:
        configuration = job.get("configuration") or {}
        if settings.apify_api_token:
            items, found = await collect_apify_search(client, settings, configuration)
            received_count = len(items)
            for candidate in found:
                if candidate.get("pet_type") in {"cat", "dog"}:
                    candidates[candidate["post_id"]] = _cloud_candidate(candidate)
        else:
            received_count = await _collect_with_local_x_cookie(
                settings,
                configuration,
                candidates,
            )
    except Exception as error:
        message = str(error)
        blocked_terms = (
            "captcha", "cloudflare", "unauthorized", "forbidden", "rate limit", "no account",
            "apify authorization", "usage limit", "not enough credits",
        )
        status = "blocked" if any(term in message.lower() for term in blocked_terms) else "failed"
        error_code = "source_access_blocked" if status == "blocked" else "discovery_failed"
        if status == "blocked" and settings.apify_api_token:
            error_message = "Apify access paused. Check the local token, account usage, and Actor availability."
        elif status == "blocked":
            error_message = "X access paused. Re-import a valid cookie or wait for the rate limit."
        else:
            error_message = f"Read-only discovery failed: {type(error).__name__}"

    response = await client.post(
        f"{settings.diy_site_url}/api/x-leads/worker/jobs/{job['id']}/complete",
        headers=headers,
        json={
            "workerId": worker_id,
            "status": status,
            "receivedCount": received_count,
            "errorCode": error_code,
            "errorMessage": error_message,
            "candidates": list(candidates.values()) if status == "completed" else [],
        },
    )
    response.raise_for_status()


async def _collect_with_local_x_cookie(
    settings: Settings,
    configuration: dict[str, Any],
    candidates: dict[str, dict[str, Any]],
) -> int:
    received_count = 0
    segments = [
        segment for segment in SEARCH_SEGMENTS
        if segment.key in configuration.get("segments", [])
    ]
    if not segments:
        raise ValueError("No supported audience segment was selected.")
    result_limit = max(1, min(100, int(configuration.get("resultLimit", 40))))
    per_segment = max(1, result_limit // len(segments))
    for segment in segments:
        geo_limit = max(1, per_segment // 2)
        broad_limit = max(1, per_segment - geo_limit)
        for query, limit in (
            (f"{segment.query} place_country:US", geo_limit),
            (segment.query, broad_limit),
        ):
            items, found = await collect_search(
                query,
                str(configuration.get("searchProduct", "Latest")),
                limit,
                segment.key,
                cookie_path=CREDENTIAL_PATH,
                lookback_days=max(1, min(90, int(configuration.get("lookbackDays", 30)))),
                us_required=bool(configuration.get("usRequired", True)),
                us_min_confidence=max(0, min(100, int(configuration.get("usMinConfidence", 70)))),
            )
            received_count += len(items)
            for candidate in found:
                if candidate.get("pet_type") in {"cat", "dog"}:
                    candidates[candidate["post_id"]] = _cloud_candidate(candidate)
    return received_count


def _cloud_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    targeting_data = json.loads(candidate.get("targeting_json") or "{}")
    return {
        "postId": candidate["post_id"],
        "authorHash": candidate["author_hash"],
        "handle": candidate["author_handle"],
        "postUrl": candidate["post_url"],
        "mediaUrl": candidate["media_url"],
        "postedAt": candidate.get("posted_at"),
        "selectionStatus": candidate["status"],
        "segment": candidate["segment"],
        "petType": candidate["pet_type"],
        "occasion": candidate.get("occasion"),
        "occasionConfidence": candidate.get("occasion_confidence"),
        "ownershipConfidence": candidate.get("ownership_confidence"),
        "usConfidence": candidate.get("us_confidence"),
        "usEvidence": candidate.get("us_evidence"),
        "leadScore": None,
        "likeCount": candidate.get("like_count", 0),
        "replyCount": candidate.get("reply_count", 0),
        "repostCount": candidate.get("repost_count", 0),
        "viewCount": candidate.get("view_count", 0),
        "followersCount": candidate.get("followers_count", 0),
        "targetingData": {
            **targeting_data,
            "engagement_quality": candidate.get("engagement_quality"),
            "account_quality": candidate.get("account_quality"),
            "recency_score": candidate.get("recency_score"),
        },
    }
