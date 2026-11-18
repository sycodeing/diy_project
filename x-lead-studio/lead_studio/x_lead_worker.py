from __future__ import annotations

import asyncio
import json
import socket
from pathlib import Path
from typing import Any

import httpx

from .apify import collect_apify_search
from .config import CREDENTIAL_PATH, TWITTERAPI_ARCHIVE_DIR, Settings
from .discovery import collect_search, dedupe_candidates_by_author
from .demand_photo import attach_same_account_photo, record_verified_photo_source
from .pet_image_gate import ensure_pet_image_verifier, verify_pet_photo
from .targeting import SEARCH_SEGMENTS
from .purchase_intent import DEMAND_SEGMENT_KEYS, DEMAND_SCENES
from .twitterapi import collect_twitterapi_search


CLOUD_SEGMENTS = {
    "new_adoption", "pet_birthday", "pet_adventure", "pet_costume", "pet_portrait", "custom",
}


async def run_x_lead_worker(settings: Settings) -> None:
    if not settings.x_lead_worker_enabled or len(settings.x_lead_worker_secret) < 32:
        return
    provider = _selected_provider(settings)
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
                        "cookieConfigured": _provider_is_configured(settings, provider),
                        "version": "1.15.0",
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
    if (job.get("configuration") or {}).get("discoveryMode") == "purchase_recall":
        await _execute_recall_job(client, headers, settings, worker_id, job)
        return
    received_count = 0
    candidates: dict[str, dict[str, Any]] = {}
    status = "completed"
    error_code = None
    error_message = None
    metrics: dict[str, Any] = {"provider": _selected_provider(settings)}
    found_for_image_review: list[dict[str, Any]] = []
    local_review: dict[str, dict[str, Any]] = {}
    is_demand = False
    requested_scenes: set[str] = set()
    scene_target = 20
    try:
        configuration = job.get("configuration") or {}
        provider = _selected_provider(settings)
        is_demand = bool(set(configuration.get("segments", [])) & set(DEMAND_SEGMENT_KEYS))
        if is_demand:
            if provider != "twitterapi" or not set(configuration.get("segments", [])).issubset(DEMAND_SEGMENT_KEYS):
                raise ValueError("Demand discovery requires TwitterAPI and separate demand-only segments")
            configuration = {**configuration, "usRequired": True, "usMinConfidence": max(70, int(configuration.get("usMinConfidence", 70)))}
            scene_target = max(1, min(100, int(configuration.get("qualifiedPerScene", 20))))
            requested_scenes = set()
            for key in configuration["segments"]:
                if key in {"demand_reply", "demand_discussion"}:
                    requested_scenes.update(("custom", "gift"))
                else:
                    requested_scenes.add("custom" if key == "demand_recommendation" else key.removeprefix("demand_"))
        if not is_demand:
            await ensure_pet_image_verifier(client, settings)
        if provider == "twitterapi":
            items, found, metrics = await collect_twitterapi_search(
                client,
                settings,
                configuration,
                archive_id=str(job.get("id") or ""),
            )
            received_count = len(items)
            found_for_image_review = found
        elif provider == "apify":
            items, found = await collect_apify_search(client, settings, configuration)
            received_count = len(items)
            metrics = {"provider": "apify", "received_posts": received_count, "candidate_posts": len(found)}
            found_for_image_review = found
        elif provider == "x-cookie":
            received_count = await _collect_with_local_x_cookie(
                settings,
                configuration,
                found_for_image_review,
            )
            metrics = {"provider": "x-cookie", "received_posts": received_count,
                       "candidate_posts": len(found_for_image_review)}
        else:
            raise ValueError(f"Unsupported X lead provider: {provider}")
        if provider in {"twitterapi", "apify", "x-cookie"}:
            if is_demand:
                metrics["discovery_mode"] = "purchase_intent"
                for candidate in found_for_image_review:
                    intent = json.loads(candidate.get("targeting_json") or "{}").get("purchase_intent") or {}
                    if (intent.get("tier") == "excluded" or candidate.get("status") == "rejected_targeting"
                            or candidate.get("organization") or candidate.get("advertisement")):
                        continue
                    post_id = str(candidate.get("post_id") or "")
                    if post_id:
                        local_review[post_id] = {
                            "post_id": post_id,
                            "post_url": candidate.get("post_url"),
                            "author_handle": candidate.get("author_handle"),
                            "author_id": candidate.get("author_id"),
                            "author_hash": candidate.get("author_hash"),
                            "posted_at": candidate.get("posted_at"),
                            "intent": intent,
                            "us_confidence": candidate.get("us_confidence"),
                            "us_evidence": candidate.get("us_evidence"),
                            "disposition": "awaiting_preview_evidence",
                        }
                        if candidate.get("status") == "location_review":
                            local_review[post_id]["disposition"] = "location_pending"
                        if intent.get("product_fit") != "pillow":
                            local_review[post_id]["disposition"] = "product_fit_review"
                        if intent.get("tier") == "exploratory":
                            local_review[post_id]["disposition"] = "potential_consumer_review_only"
                metrics["intent_rejected"] = metrics.get("intent_prefilter_rejected", 0) + sum(
                    json.loads(c.get("targeting_json") or "{}").get("purchase_intent", {}).get("tier") == "excluded"
                    for c in found_for_image_review
                )
                metrics["intent_location_pending"] = sum(c.get("status") == "location_review" for c in found_for_image_review)
                metrics["intent_outside_requested_scenes"] = sum(
                    json.loads(c.get("targeting_json") or "{}").get("purchase_intent", {}).get("scene") not in requested_scenes
                    for c in found_for_image_review
                    if json.loads(c.get("targeting_json") or "{}").get("purchase_intent", {}).get("tier") != "excluded"
                )
                found_for_image_review = [c for c in found_for_image_review
                    if c.get("status") in {"new", "targeting_review"}
                    and int(c.get("us_confidence", 0)) >= 70
                    and json.loads(c.get("targeting_json") or "{}").get("purchase_intent", {}).get("scene") in requested_scenes
                    and json.loads(c.get("targeting_json") or "{}").get("purchase_intent", {}).get("tier") == "explicit_request"
                    and json.loads(c.get("targeting_json") or "{}").get("purchase_intent", {}).get("product_fit") == "pillow"
                    and c.get("us_evidence") != "profile_location_state"]
                selected_ids = {str(c.get("post_id")) for c in found_for_image_review}
                for post_id, review in local_review.items():
                    if post_id not in selected_ids and review["disposition"] == "awaiting_preview_evidence":
                        review["disposition"] = "outside_requested_scene_or_us_gate"
                found_for_image_review.sort(key=lambda c: (
                    json.loads(c.get("targeting_json") or "{}").get("purchase_intent", {}).get("score", 0),
                    c.get("recency_score") or 0,
                ), reverse=True)
                deduped = dedupe_candidates_by_author(found_for_image_review)
                retained_ids = {str(candidate["post_id"]) for candidate in deduped}
                metrics["demand_duplicate_author_review"] = len(found_for_image_review) - len(deduped)
                for candidate in found_for_image_review:
                    if str(candidate["post_id"]) not in retained_ids:
                        local_review[str(candidate["post_id"])]["disposition"] = "duplicate_author"
                found_for_image_review = deduped
                photo_lookup_cap = min(60, scene_target * len(requested_scenes) * 2)
                metrics["photo_lookup_cap"] = photo_lookup_cap
                metrics["photo_lookup_deferred"] = max(0, len(found_for_image_review) - photo_lookup_cap)
                for candidate in found_for_image_review[photo_lookup_cap:]:
                    local_review[str(candidate["post_id"])]["disposition"] = "preview_lookup_deferred"
                found_for_image_review = found_for_image_review[:photo_lookup_cap]
                if found_for_image_review:
                    await ensure_pet_image_verifier(client, settings)
            checked = 0
            verified = 0
            photo_matched = 0
            for candidate in found_for_image_review:
                candidate_post_id = str(candidate.get("post_id") or "")
                if candidate.get("status") == "rejected_targeting":
                    continue
                sources: dict[str, dict[str, Any]] = {}
                if is_demand:
                    had_original_photo = bool(candidate.get("media_urls"))
                    ownership_pending = bool(json.loads(candidate.get("targeting_json") or "{}").get("ownership_evidence_pending"))
                    candidate, sources = await attach_same_account_photo(
                        candidate, client, settings, archive_id=str(job.get("id") or ""),
                        force_search=ownership_pending,
                    )
                    if not candidate:
                        local_review[str(candidate_post_id)]["disposition"] = "same_account_photo_missing"
                        continue
                    photo_matched += 1
                checked += 1
                selected = await verify_pet_photo(candidate, client, settings)
                if is_demand and not selected and had_original_photo and not ownership_pending:
                    fallback, fallback_sources = await attach_same_account_photo(
                        candidate, client, settings, archive_id=str(job.get("id") or ""),
                        force_search=True,
                    )
                    if fallback:
                        checked += 1
                        selected = await verify_pet_photo(fallback, client, settings)
                        if selected:
                            sources = fallback_sources
                if selected and is_demand:
                    selected = record_verified_photo_source(selected, sources)
                if selected:
                    verified += 1
                    candidates[selected["post_id"]] = _cloud_candidate(selected)
                    if is_demand:
                        local_review.pop(str(selected["post_id"]), None)
                elif is_demand:
                    local_review[str(candidate_post_id)]["disposition"] = "photo_not_preview_verified"
            metrics = {**metrics, "image_checked": checked, "image_verified": verified,
                       "image_rejected": checked - verified}
            if is_demand:
                metrics["photo_source_matched"] = photo_matched
                metrics["photo_source_missing"] = len(found_for_image_review) - photo_matched
    except Exception as error:
        message = str(error)
        if is_demand and "image verification" in message.lower():
            for review in local_review.values():
                if review["disposition"] == "awaiting_preview_evidence":
                    review["disposition"] = "vision_unavailable"
        blocked_terms = (
            "captcha", "cloudflare", "unauthorized", "forbidden", "rate limit", "no account",
            "apify authorization", "usage limit", "not enough credits", "credits are exhausted",
            "pet image verification is not configured", "connection refused",
        )
        status = "blocked" if isinstance(error, httpx.ConnectError) or any(
            term in message.lower() for term in blocked_terms
        ) else "failed"
        error_code = "source_access_blocked" if status == "blocked" else "discovery_failed"
        provider = _selected_provider(settings)
        if status == "blocked" and "image verification" in message.lower():
            error_message = "Pet image verification is unavailable. Check the local Ollama vision model or vision API configuration."
        elif status == "blocked" and isinstance(error, httpx.ConnectError):
            error_message = "Pet image verification or the discovery provider is unreachable. Check the local worker services."
        elif status == "blocked" and provider == "twitterapi":
            error_message = "TwitterAPI.io access paused. Check the local API key and account credits."
        elif status == "blocked" and provider == "apify":
            error_message = "Apify access paused. Check the local token, account usage, and Actor availability."
        elif status == "blocked":
            error_message = "X access paused. Re-import a valid cookie or wait for the rate limit."
        else:
            error_message = f"Read-only discovery failed: {type(error).__name__}"

    submitted_candidates = list(candidates.values()) if status == "completed" else []
    if is_demand and metrics.get("archive_id"):
        archive_id = str(metrics["archive_id"])
        review_path = _write_local_review_leads(TWITTERAPI_ARCHIVE_DIR, archive_id,
                                                str(job.get("id") or ""), local_review,
                                                set(candidates) if status == "completed" else set())
        review_rows = json.loads(review_path.read_text(encoding="utf-8"))["records"]
        metrics["local_text_demand_records"] = len(review_rows)
        metrics["local_review_leads"] = sum(row.get("disposition") != "targeting_rejected" for row in review_rows)
        metrics["local_review_unique_authors"] = len({row.get("author_id") or row.get("author_hash")
                                                       for row in review_rows if row.get("author_id") or row.get("author_hash")})
        metrics["local_review_file"] = str(review_path.relative_to(TWITTERAPI_ARCHIVE_DIR))
    deduped_candidates = dedupe_candidates_by_author(submitted_candidates)
    metrics = {
        **metrics,
        "duplicate_account_candidates": len(submitted_candidates) - len(deduped_candidates),
    }
    if is_demand and status == "completed":
        # These are submission counts BEFORE the hosted historical/contact
        # dedupe. They must never be reported as final new qualified leads.
        counts = {scene: 0 for scene in DEMAND_SCENES if scene in requested_scenes}
        selected = []
        for candidate in deduped_candidates:
            scene = candidate["targetingData"].get("purchase_intent", {}).get("scene")
            if scene in counts and counts[scene] < scene_target:
                selected.append(candidate)
                counts[scene] += 1
        deduped_candidates = selected
        metrics.update(scene_target=scene_target, scene_submitted=counts,
                       scene_submission_gap={scene: scene_target - count for scene, count in counts.items()})
    response = await client.post(
        f"{settings.diy_site_url}/api/x-leads/worker/jobs/{job['id']}/complete",
        headers=headers,
        json={
            "workerId": worker_id,
            "status": status,
            "receivedCount": received_count,
            "errorCode": error_code,
            "errorMessage": error_message,
            "metrics": metrics,
            "candidates": deduped_candidates,
        },
    )
    response.raise_for_status()


async def _execute_recall_job(
    client: httpx.AsyncClient, headers: dict[str, str], settings: Settings,
    worker_id: str, job: dict[str, Any],
) -> None:
    """Paid bounded search, raw review only; no photo, lead, or send path."""
    from probe_purchase_recall import extract_raw_reviews, run_recall_probe

    config = job.get("configuration") or {}
    status = "completed"
    error_code = None
    error_message = None
    metrics: dict[str, Any] = {"discovery_mode": "purchase_recall", "scope": "raw_review_only"}
    rows: list[dict[str, Any]] = []
    try:
        if _selected_provider(settings) != "twitterapi":
            raise ValueError("Purchase recall requires TwitterAPI")
        summary = await run_recall_probe(
            client, settings,
            lookback_days=int(config.get("lookbackDays", 3)),
            max_pages=int(config.get("maxPages", 8)),
            target_new_posts=int(config.get("targetNewPosts", 20)),
            diagnose_control=False,
        )
        metrics.update(summary)
        rows = extract_raw_reviews([Path(summary["archive_path"])])
        if summary["status"] != "completed":
            status = "blocked"
            error_code = str(summary["status"])
            error_message = "Bounded recall stopped; raw pages remain archived for review."
    except Exception as error:
        # A later page can fail after earlier raw pages were safely archived.
        # Preserve those rows in the review table even though the job failed.
        archive_path = getattr(error, "archive_path", None)
        if isinstance(archive_path, Path) and archive_path.is_file():
            rows = extract_raw_reviews([archive_path])
            archive = json.loads(archive_path.read_text(encoding="utf-8"))
            metrics.update(archive.get("summary") or {})
            metrics["archive_path"] = str(archive_path)
        status = "blocked" if isinstance(error, (httpx.HTTPError, RuntimeError)) else "failed"
        error_code = "recall_source_blocked" if status == "blocked" else "recall_failed"
        error_message = f"Read-only recall failed: {type(error).__name__}"
    response = await client.post(
        f"{settings.diy_site_url}/api/x-leads/worker/jobs/{job['id']}/complete",
        headers=headers,
        json={
            "workerId": worker_id, "status": status,
            "receivedCount": min(1000, int(metrics.get("shopping_query_new_posts_vs_baseline", 0))),
            "errorCode": error_code, "errorMessage": error_message,
            "metrics": {**metrics, "provider": "twitterapi", "scope": "raw_review_only",
                        "raw_review_rows": len(rows), "strict_qualified": 0},
            "candidates": [], "rawCandidates": rows[:200],
        },
    )
    response.raise_for_status()


def _write_local_review_leads(archive_root: Path, archive_id: str, job_id: str,
                              pending: dict[str, dict[str, Any]],
                              verified_post_ids: set[str]) -> Path:
    """Persist text-demand audit separately from the strict hosted lead pool."""
    safe_id = archive_id if archive_id and all(char.isalnum() or char in "-_." for char in archive_id) else job_id
    if not safe_id or safe_id in {".", ".."} or not all(char.isalnum() or char in "-_." for char in safe_id):
        raise ValueError("Unsafe archive id for local demand review")
    archive_path = archive_root / f"{safe_id}.json"
    source = json.loads(archive_path.read_text(encoding="utf-8")) if archive_path.exists() else {}
    rows: dict[str, dict[str, Any]] = {}
    for row in source.get("review_leads", []):
        post_id = str(row.get("post_id") or "")
        if post_id and post_id not in verified_post_ids:
            rows[post_id] = row
    for post_id, row in pending.items():
        if post_id not in verified_post_ids:
            rows[post_id] = {**rows.get(post_id, {}), **row}
    by_author: dict[str, dict[str, Any]] = {}
    for row in sorted(rows.values(), key=lambda value: (
        value.get("disposition") != "targeting_rejected",
        int((value.get("intent") or {}).get("score") or 0),
        value.get("posted_at") or "",
    ), reverse=True):
        key = str(row.get("author_id") or row.get("author_hash") or row.get("author_handle")
                  or row["post_id"]).casefold()
        by_author.setdefault(key, row)
    destination = archive_root / "review_leads" / f"{safe_id}.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".part")
    temporary.write_text(json.dumps({
        "version": 1, "source_archive": archive_path.name, "source_job_id": job_id,
        "scope": "local_text_demand_review_only_not_hosted_x_leads_or_contact_approval",
        "records": list(by_author.values()),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(destination)
    return destination


def _selected_provider(settings: Settings) -> str:
    provider = settings.x_lead_provider
    if provider == "apify" and not settings.apify_enabled:
        return "apify-disabled"
    return provider


def _provider_is_configured(settings: Settings, provider: str) -> bool:
    if provider == "twitterapi":
        return bool(settings.twitterapi_api_key)
    if provider == "apify":
        return settings.apify_enabled and bool(settings.apify_api_token)
    if provider == "x-cookie":
        return CREDENTIAL_PATH.exists()
    return False


async def _collect_with_local_x_cookie(
    settings: Settings,
    configuration: dict[str, Any],
    candidates: list[dict[str, Any]],
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
                    candidates.append(candidate)
    return received_count


def _cloud_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    targeting_data = json.loads(candidate.get("targeting_json") or "{}")
    discovery_segment = str(candidate.get("segment") or "custom")
    cloud_segment = discovery_segment if discovery_segment in CLOUD_SEGMENTS else "custom"
    return {
        "postId": candidate["post_id"],
        "authorHash": candidate["author_hash"],
        "handle": candidate["author_handle"],
        "postUrl": candidate["post_url"],
        "mediaUrl": candidate["media_url"],
        "mediaUrls": candidate.get("media_urls") or [candidate["media_url"]],
        "postedAt": candidate.get("posted_at"),
        "selectionStatus": candidate["status"],
        "segment": cloud_segment,
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
            **({"demand_author_id": candidate.get("author_id")} if targeting_data.get("discovery_mode") == "purchase_intent" else {}),
            "discovery_segment": discovery_segment,
            "engagement_quality": candidate.get("engagement_quality"),
            "account_quality": candidate.get("account_quality"),
            "recency_score": candidate.get("recency_score"),
        },
    }
