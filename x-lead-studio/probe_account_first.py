"""Manual, archive-first account discovery from one reviewer-verified seed post.

No search, cloud strict candidate, preview, draft approval, or outreach is performed.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import hashlib
import json
import re
import uuid
from typing import Any

import httpx

from lead_studio.account_assessment import VERSION as ASSESSMENT_VERSION, assess_account
from lead_studio.config import Settings, TWITTERAPI_ARCHIVE_DIR
from lead_studio.twitterapi import _iso_datetime
from probe_purchase_recall import _credits, _save

VERSION = ASSESSMENT_VERSION
SEED_PATH = "/twitter/tweets"
REPLIES_PATH = "/twitter/tweet/replies/v2"
RECENT_PATH = "/twitter/user/last_tweets"
MAX_ACCOUNTS = 4
MAX_CREDITS = 1800
STATIC_RESERVE = 15 + 20 * 15 + MAX_ACCOUNTS * 21 * 15  # 1575, includes optional pinned tweet.


def _valid_response(payload: Any) -> bool:
    return (isinstance(payload, dict)
            and str(payload.get("status") or "").lower() not in {"error", "failed"}
            and payload.get("code") in (None, 0, "0"))


def _timeline_cache_key(settings: Settings, endpoint: str, params: dict[str, str]) -> str:
    identity = {"base_url": settings.twitterapi_base_url.rstrip("/"), "endpoint": endpoint,
                "params": params, "credential_fingerprint": hashlib.sha256(
                    settings.twitterapi_api_key.encode("utf-8")).hexdigest()}
    return hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _cached_timeline(cache_dir: Path, key: str, author_id: str, started: datetime,
                     ttl_hours: int) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    if ttl_hours <= 0:
        return None
    try:
        entry = json.loads((cache_dir / f"{key}.json").read_text(encoding="utf-8"))
        fetched_at = datetime.fromisoformat(entry["provider_received_at"])
        age = started - fetched_at
        payload = entry["response"]
        source_id = entry.get("source_archive_id")
        if (entry.get("cache_key") != key or not isinstance(source_id, str)
                or not re.fullmatch(r"account-first-[\w-]+", source_id)
                or not (cache_dir.parent / f"{source_id}.json").is_file()
                or not isinstance(entry.get("source_request_index"), int)
                or entry["source_request_index"] < 0 or fetched_at.tzinfo is None
                or not timedelta(0) <= age <= timedelta(hours=ttl_hours)
                or not _valid_response(payload)):
            return None
        posts = _posts(payload, RECENT_PATH)
        if any(not isinstance(p, dict) or _author(p)[0] != author_id for p in posts):
            return None
        return entry, posts
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _save_timeline_cache(cache_dir: Path, key: str, entry: dict[str, Any]) -> None:
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        target = cache_dir / f"{key}.json"
        temporary = cache_dir / f"{key}.{uuid.uuid4().hex}.tmp"
        temporary.write_text(json.dumps(entry, ensure_ascii=False), encoding="utf-8")
        temporary.replace(target)
    except OSError:
        # A cache write failure cannot invalidate a successfully archived provider page.
        pass


def _author(post: dict[str, Any]) -> tuple[str, str]:
    value = post.get("author") if isinstance(post.get("author"), dict) else {}
    author_id = str(value.get("id") or value.get("id_str") or "")
    handle = str(value.get("userName") or value.get("username") or "").lstrip("@")
    return author_id, handle


def _posts(payload: dict[str, Any], path: str) -> list[dict[str, Any]]:
    if path == RECENT_PATH:
        data = payload.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("tweets"), list):
            raise ValueError("Invalid last_tweets data.tweets response")
        tweets = data["tweets"]
        pin = data.get("pin_tweet")
        if pin is not None and not isinstance(pin, dict):
            raise ValueError("Invalid last_tweets data.pin_tweet response")
        if len(tweets) > 20:
            raise ValueError("Last tweets page exceeded documented bound")
        ids = {str(p.get("id") or p.get("id_str")) for p in tweets if isinstance(p, dict)}
        return [*tweets, *([pin] if pin and str(pin.get("id") or pin.get("id_str")) not in ids else [])]
    tweets = payload.get("tweets")
    if not isinstance(tweets, list) or len(tweets) > 20:
        raise ValueError("Invalid or oversized tweet page")
    return tweets


def _in_window(post: dict[str, Any], since: datetime, until: datetime) -> bool:
    try:
        stamp = datetime.fromisoformat(_iso_datetime(post.get("createdAt") or post.get("created_at")))
        return stamp.tzinfo is not None and since <= stamp <= until
    except (TypeError, ValueError):
        return False


async def run_account_first_probe(
    client: httpx.AsyncClient, settings: Settings, *, seed_post_id: str,
    verification_note: str, contacted_snapshot: dict[str, Any],
    archive_dir: Path = TWITTERAPI_ARCHIVE_DIR, now: datetime | None = None,
    source_job_id: str | None = None,
) -> dict[str, Any]:
    if not re.fullmatch(r"\d{5,30}", seed_post_id) or len(verification_note.strip()) < 12:
        raise ValueError("Verified seed ID and reviewer rationale are required")
    if not settings.twitterapi_api_key:
        raise RuntimeError("TwitterAPI key is required")
    if (not isinstance(contacted_snapshot, dict) or not contacted_snapshot.get("snapshot_at")
            or not all(isinstance(contacted_snapshot.get(key), (list, set))
                       for key in ("post_ids", "author_ids", "handles"))):
        raise ValueError("Complete contacted snapshot required before any paid call")
    if STATIC_RESERVE > MAX_CREDITS:
        raise RuntimeError("Account probe static reserve exceeds hard bound")
    contacted_ids = {str(v) for v in contacted_snapshot["author_ids"]}
    contacted_handles = {str(v).lower().lstrip("@") for v in contacted_snapshot["handles"]}
    contacted_posts = {str(v) for v in contacted_snapshot["post_ids"]}
    started = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    since = started - timedelta(days=14)
    archive_id = f"account-first-{started:%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}"
    path = archive_dir / f"{archive_id}.json"
    cache_dir = archive_dir / "account-first-timeline-cache"
    cache_hours = getattr(settings, "twitterapi_account_timeline_cache_hours", 6)
    force_refresh = getattr(settings, "twitterapi_account_timeline_force_refresh", False)
    document: dict[str, Any] = {
        "archive_version": 1, "kind": "account_first_raw_only", "archive_id": archive_id,
        "classifier_version": VERSION, "started_at": started.isoformat(), "status": "collecting",
        "seed_post_id": seed_post_id, "seed_verification_note": verification_note.strip()[:1000],
        "source_job_id": source_job_id,
        "lookback_days": 14, "max_accounts_enriched": MAX_ACCOUNTS,
        "max_credits": MAX_CREDITS, "static_reserved_credits": STATIC_RESERVE,
        "contacted_snapshot": {"snapshot_at": contacted_snapshot["snapshot_at"],
                               **{key: len(contacted_snapshot[key]) for key in ("post_ids", "author_ids", "handles")}},
        "requests": [], "cache_reuses": [], "account_candidates": [],
    }
    _save(path, document)
    try:
        before = await _credits(client, settings)
        document["credits_before"] = before
        if sum(before.values()) - 315 < 3000:
            document["status"] = "stopped_credit_reserve"
            return {"status": document["status"], "archive_path": str(path), "archive_id": archive_id,
                    "account_candidates": [], "metrics": {"paid_requests": 0}}
        reserved = 0
        async def fetch(endpoint: str, params: dict[str, str], reserve: int) -> list[dict[str, Any]]:
            nonlocal reserved
            cache_key = _timeline_cache_key(settings, endpoint, params) if endpoint == RECENT_PATH else None
            if cache_key and not force_refresh:
                cached = _cached_timeline(cache_dir, cache_key, params["userId"],
                                          datetime.now(timezone.utc),
                                          cache_hours)
                if cached is not None:
                    entry, posts = cached
                    document["cache_reuses"].append({
                        "endpoint": endpoint, "request_params": params,
                        "source_archive_id": entry.get("source_archive_id"),
                        "source_request_index": entry.get("source_request_index"),
                        "provider_received_at": entry["provider_received_at"],
                        "reused_at": datetime.now(timezone.utc).isoformat(),
                        "returned_items": len(posts)})
                    _save(path, document)
                    return posts
            if reserved + reserve > MAX_CREDITS:
                raise RuntimeError("Static paid-call bound reached")
            current = await _credits(client, settings)
            if (min(sum(current.values()), sum(before.values()) - reserved) - reserve < 3000
                    or sum(before.values()) - sum(current.values()) + reserve > MAX_CREDITS):
                raise RuntimeError("Credit reserve reached")
            attempt: dict[str, Any] = {"endpoint": endpoint, "request_params": params,
                                       "reserved_credits": reserve,
                                       "requested_at": datetime.now(timezone.utc).isoformat(),
                                       "state": "attempted"}
            document["requests"].append(attempt)
            reserved += reserve
            _save(path, document)  # A timeout can still be billable; record it before calling.
            try:
                response = await client.get(f"{settings.twitterapi_base_url}{endpoint}",
                                            headers={"X-API-Key": settings.twitterapi_api_key}, params=params)
            except Exception as error:
                attempt.update(state="transport_error", error_type=type(error).__name__)
                _save(path, document)
                raise
            try:
                payload = response.json()
            except ValueError:
                payload = {"invalid_json": True}
            attempt.update(state="response_received", http_status=response.status_code,
                           response=payload, received_at=datetime.now(timezone.utc).isoformat())
            _save(path, document)  # Paid raw response is durable before parsing or classification.
            if response.status_code != 200 or not _valid_response(payload):
                raise RuntimeError(f"Provider response error: {endpoint} HTTP {response.status_code}")
            posts = _posts(payload, endpoint)
            if (cache_key and cache_hours > 0
                    and all(isinstance(p, dict) and _author(p)[0] == params["userId"] for p in posts)):
                _save_timeline_cache(cache_dir, cache_key, {
                    "cache_key": cache_key, "provider_received_at": attempt["received_at"],
                    "source_archive_id": archive_id,
                    "source_request_index": len(document["requests"]) - 1, "response": payload})
            return posts

        seed_posts = await fetch(SEED_PATH, {"tweet_ids": seed_post_id}, 15)
        seed = next((p for p in seed_posts if str(p.get("id") or p.get("id_str")) == seed_post_id), None)
        if not seed or seed.get("isReply") or seed.get("inReplyToId"):
            raise ValueError("Verified seed missing or is itself a reply")
        seed_author, _ = _author(seed)
        document["seed_author_id"] = seed_author
        replies = await fetch(REPLIES_PATH, {"tweetId": seed_post_id, "cursor": "",
                                             "queryType": "Latest"}, 300)
        groups: dict[str, dict[str, Any]] = {}
        # A verified personal source can itself be an account under review. Its
        # own post is evidence; it must never be counted as one of its replies.
        seed_handle = _author(seed)[1]
        source_contacted = (seed_author in contacted_ids or seed_handle.lower() in contacted_handles
                            or seed_post_id in contacted_posts)
        if not source_contacted and _in_window(seed, since, started):
            source_check = assess_account(seed_author, seed_handle, [], [seed],
                                          seed_id=seed_post_id, seed_text=str(seed.get("text") or ""),
                                          timeline_status="capacity_pending")
            if (source_check["accountStatus"] == "watch"
                    and source_check["accountEvidence"]["project_evidence"]):
                groups[seed_author] = {"handle": seed_handle, "replies": [],
                                       "source_post": seed, "role": "source_author"}
        for post in replies:
            if not isinstance(post, dict) or not _in_window(post, since, started):
                continue
            author_id, handle = _author(post)
            post_id = str(post.get("id") or post.get("id_str") or "")
            if (not re.fullmatch(r"\d{5,30}", author_id) or not post_id
                    or post_id == seed_post_id or author_id == seed_author
                    or str(post.get("conversationId") or "") != seed_post_id):
                continue
            if (author_id in contacted_ids or handle.lower() in contacted_handles
                    or post_id in contacted_posts):
                continue
            group = groups.setdefault(author_id, {"handle": handle, "replies": [],
                                                  "source_post": None, "role": "reply_author"})
            if post_id not in {str(p.get("id") or p.get("id_str")) for p in group["replies"]}:
                group["replies"].append(post)
        # Stable first-seen order in the archived reply page; one timeline request per author.
        stop_enrichment = False
        for index, (author_id, group) in enumerate(groups.items()):
            recent: list[dict[str, Any]] = []
            timeline_status = "provider_pending" if stop_enrichment else "capacity_pending" if index >= MAX_ACCOUNTS else "complete"
            if index < MAX_ACCOUNTS and not stop_enrichment:
                try:
                    raw = await fetch(RECENT_PATH, {"userId": author_id, "cursor": "",
                                                    "includeReplies": "false"}, 315)
                    recent = [p for p in raw if isinstance(p, dict) and _author(p)[0] == author_id
                              and _in_window(p, since, started)]
                except Exception as error:
                    timeline_status = "provider_pending"
                    document.setdefault("enrichment_errors", []).append({"author_id": author_id,
                                                                            "error_type": type(error).__name__})
                    # Auth, provider, malformed payload, or budget errors stop further paid calls.
                    document["status"] = "stopped_enrichment_error"
                    stop_enrichment = True
            if group["source_post"] is not None:
                recent = [group["source_post"], *recent]
            row = assess_account(author_id, group["handle"], group["replies"], recent,
                                 seed_id=seed_post_id, seed_text=str(seed.get("text") or ""),
                                 timeline_status=timeline_status)
            row["sourceArchive"] = archive_id
            row["accountEvidence"]["source_role"] = group["role"]
            row["sourceHistory"] = [{"archive_id": archive_id, "seed_post_id": seed_post_id,
                                     "source_job_id": source_job_id,
                                     "source_role": group["role"],
                                     "reply_post_ids": [str(p.get("id") or p.get("id_str")) for p in group["replies"]],
                                     "recent_post_ids": [str(p.get("id") or p.get("id_str")) for p in recent]}]
            document["account_candidates"].append(row)
            _save(path, document)
        if document["status"] == "collecting":
            document["status"] = "completed"
        try:
            document["credits_after"] = await _credits(client, settings)
        except Exception:
            document["credit_settlement_pending"] = True
    except Exception as error:
        document["status"] = "stopped_provider_error"
        document["error_type"] = type(error).__name__
    finally:
        document["finished_at"] = datetime.now(timezone.utc).isoformat()
        _save(path, document)
    statuses: dict[str, int] = {}
    for row in document["account_candidates"]:
        statuses[row["accountStatus"]] = statuses.get(row["accountStatus"], 0) + 1
    return {"status": document["status"], "archive_path": str(path), "archive_id": archive_id,
            "account_candidates": document["account_candidates"],
            "metrics": {"provider": "twitterapi", "scope": "account_review_only",
                        "paid_requests": len(document["requests"]),
                        "timeline_cache_hits": len(document["cache_reuses"]),
                        "estimated_avoided_credits": sum(max(1, item["returned_items"]) * 15
                                                         for item in document["cache_reuses"]),
                        "returned_reply_page_items": len(replies) if 'replies' in locals() else 0,
                        "returned_replies": sum(len(group["replies"]) for group in groups.values()) if 'groups' in locals() else 0,
                        "distinct_reply_authors": sum(group["role"] == "reply_author" for group in groups.values()) if 'groups' in locals() else 0,
                        "source_authors_reviewed": sum(group["role"] == "source_author" for group in groups.values()) if 'groups' in locals() else 0,
                        "accounts_enriched": sum(r["accountEvidence"]["timeline_status"] == "complete"
                                                 for r in document["account_candidates"]),
                        "account_statuses": statuses, "strict_candidates": 0,
                        "reserved_credits": sum(r["reserved_credits"] for r in document["requests"]),
                        "archive_id": archive_id}}
