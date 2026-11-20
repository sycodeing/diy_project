"""Six bounded, archive-first consumer searches for raw human review only."""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import uuid
from typing import Any

import httpx

from lead_studio.config import Settings, TWITTERAPI_ARCHIVE_DIR
from lead_studio.consumer_profiles import assess_consumer_profile
from lead_studio.twitterapi import _iso_datetime
from probe_purchase_recall import (
    CREDITS_PATH, SEARCH_PATH, RecallProbeError, _author_bio, _author_id,
    _credits, _save, historical_ids,
)

# One page per hypothesis. The first three pages cover all personas.
QUERY_TIERS = (
    ("pet_owner_1", '("my dog" OR "my cat") lang:en'),
    ("home_decorator_1", '("my living room" OR "our living room") lang:en'),
    ("relationship_memory_1", '("our first trip" OR "our anniversary") lang:en'),
    ("pet_owner_2", '("our dog" OR "our cat") (photo OR sofa OR birthday) lang:en'),
    ("home_decorator_2", '("my room" OR "our home") (sofa OR wall OR photos) lang:en'),
    ("relationship_memory_2", '("my wedding" OR "our graduation") (photo OR memories) lang:en'),
)


def is_repost(post: dict[str, Any]) -> bool:
    return (post.get("isRetweet") is True or post.get("is_retweet") is True
            or isinstance(post.get("retweetedTweet"), dict)
            or isinstance(post.get("retweeted_tweet"), dict))


def _contact_match(post: dict[str, Any], snapshot: dict[str, Any]) -> bool:
    post_id = str(post.get("id") or post.get("id_str") or "")
    author = post.get("author") if isinstance(post.get("author"), dict) else {}
    author_id = str(author.get("id") or author.get("id_str") or "")
    handle = str(author.get("userName") or author.get("username") or "").lower().lstrip("@")
    return (post_id in snapshot["post_ids"] or (author_id and author_id in snapshot["author_ids"])
            or (handle and handle in snapshot["handles"]))


async def run_consumer_recall_probe(
    client: httpx.AsyncClient, settings: Settings, *, contacted_snapshot: dict[str, Any],
    archive_dir: Path = TWITTERAPI_ARCHIVE_DIR, lookback_days: int = 3,
    max_pages: int = 6, min_balance_credits: int = 3000,
    max_observed_spend: int = 2500, now: datetime | None = None,
) -> dict[str, Any]:
    if not settings.twitterapi_api_key:
        raise RuntimeError("TWITTERAPI_API_KEY is missing")
    if not (1 <= lookback_days <= 7 and 1 <= max_pages <= 6
            and min_balance_credits >= 3000 and 1 <= max_observed_spend <= 2500):
        raise ValueError("Invalid consumer probe bounds")
    if not isinstance(contacted_snapshot, dict) or not all(
        isinstance(contacted_snapshot.get(key), (list, set))
        for key in ("post_ids", "author_ids", "handles")
    ) or not contacted_snapshot.get("snapshot_at"):
        raise ValueError("A complete contacted snapshot is required before paid search")
    snapshot = {"post_ids": set(map(str, contacted_snapshot["post_ids"])),
                "author_ids": set(map(str, contacted_snapshot["author_ids"])),
                "handles": {str(v).lower().lstrip("@") for v in contacted_snapshot["handles"]}}
    started = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    since = int((started - timedelta(days=lookback_days)).timestamp())
    until = int(started.timestamp())
    baseline_posts, _, baseline_archives = historical_ids(archive_dir)
    run_id = f"consumer-recall-{started:%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}"
    archive_path = archive_dir / f"{run_id}.json"
    document: dict[str, Any] = {
        "archive_version": 1, "kind": "query_only_consumer_recall", "archive_id": run_id,
        "started_at": started.isoformat(), "status": "collecting",
        "configuration": {"lookbackDays": lookback_days, "maxPages": max_pages,
                          "minBalanceCredits": min_balance_credits,
                          "maxObservedSpend": max_observed_spend, "queryType": "Latest",
                          "cloudStrictImport": False, "photoVerification": False},
        "baseline_archives": baseline_archives, "baseline_post_ids": len(baseline_posts),
        "contacted_snapshot": {"snapshot_at": contacted_snapshot["snapshot_at"],
                               "post_ids": len(snapshot["post_ids"]),
                               "author_ids": len(snapshot["author_ids"]),
                               "handles": len(snapshot["handles"])},
        "queries": [],
    }
    _save(archive_path, document)
    try:
        before = await _credits(client, settings)
    except Exception as error:
        document.update(status="failed_credit_check", error_type=type(error).__name__)
        _save(archive_path, document)
        raise RecallProbeError(archive_path, error) from error
    current = before
    document["credits_before"] = before
    _save(archive_path, document)
    seen: set[str] = set()
    valid: set[str] = set()
    authors: set[str] = set()
    persona_authors: dict[str, set[str]] = {name: set() for name in
                                           ("pet_owner", "home_decorator", "relationship_memory")}
    tiers: Counter[str] = Counter()
    latest: list[str] = []
    contacted_count = 0
    try:
        if sum(before.values()) < min_balance_credits:
            document["status"] = "stopped_low_balance"
        for tier_name, expression in QUERY_TIERS[:max_pages]:
            if document["status"] != "collecting":
                break
            if sum(current.values()) < min_balance_credits:
                document["status"] = "stopped_low_balance"
                break
            if sum(before.values()) - sum(current.values()) >= max_observed_spend:
                document["status"] = "stopped_spend_cap"
                break
            query = f"{expression} since_time:{since} until_time:{until}"
            params = {"query": query, "queryType": "Latest", "cursor": ""}
            entry: dict[str, Any] = {"name": tier_name, "role": "consumer",
                                     "query": query, "pages": [], "decisions": [],
                                     "counts": {"raw_rows": 0, "new_post_ids": 0,
                                                "window_valid_new_posts": 0,
                                                "out_of_window_or_invalid": 0}}
            document["queries"].append(entry)
            _save(archive_path, document)
            response = await client.get(
                f"{settings.twitterapi_base_url}{SEARCH_PATH}",
                headers={"X-API-Key": settings.twitterapi_api_key}, params=params,
            )
            try:
                payload = response.json()
            except ValueError:
                payload = {"invalid_json": True}
            entry["pages"].append({"requested_at": datetime.now(timezone.utc).isoformat(),
                                   "request_params": params, "http_status": response.status_code,
                                   "business_status": payload.get("status") if isinstance(payload, dict) else None,
                                   "response": payload})
            _save(archive_path, document)  # raw response precedes all filtering
            if (not 200 <= response.status_code < 300 or not isinstance(payload, dict)
                    or str(payload.get("status") or "").lower() == "error"):
                document["status"] = "stopped_provider_error"
                break
            posts = payload.get("tweets")
            if not isinstance(posts, list):
                document["status"] = "stopped_invalid_payload"
                break
            entry["counts"]["raw_rows"] = len(posts)
            for post in posts:
                if not isinstance(post, dict):
                    continue
                post_id = str(post.get("id") or post.get("id_str") or "")
                if not post_id or post_id in baseline_posts or post_id in seen:
                    continue
                seen.add(post_id)
                entry["counts"]["new_post_ids"] += 1
                posted_at = _iso_datetime(post.get("createdAt") or post.get("created_at"))
                try:
                    parsed = datetime.fromisoformat(posted_at)
                    seconds = int(parsed.timestamp()) if parsed.tzinfo else None
                except ValueError:
                    seconds = None
                if seconds is None or not since <= seconds <= until:
                    entry["counts"]["out_of_window_or_invalid"] += 1
                    entry["decisions"].append({"post_id": post_id,
                                               "reason": "out_of_window_or_invalid_date"})
                    continue
                valid.add(post_id)
                entry["counts"]["window_valid_new_posts"] += 1
                author_id = _author_id(post)
                if author_id:
                    authors.add(author_id)
                latest.append(posted_at)
                intent = assess_consumer_profile(str(post.get("text") or ""),
                                                 author_bio=_author_bio(post), is_repost=is_repost(post))
                if _contact_match(post, snapshot):
                    contacted_count += 1
                    intent.update(tier="excluded", persona=None, priority="none",
                                  exclusion_reasons=["previously_contacted"],
                                  contact_status="known_contacted")
                else:
                    intent["contact_status"] = "not_seen_in_snapshot"
                tiers[intent["tier"]] += 1
                if intent["persona"]:
                    persona_authors[intent["persona"]].add(author_id or post_id)
                entry["decisions"].append({"post_id": post_id, "author_id": author_id,
                                           "posted_at": posted_at, "intent": intent})
            current = await _credits(client, settings)
            document["credits_after_page"] = current
            _save(archive_path, document)
        if document["status"] == "collecting":
            document["status"] = "completed"
    except Exception as error:
        document.update(status="failed", error_type=type(error).__name__)
        raise RecallProbeError(archive_path, error) from error
    finally:
        document["completed_at"] = datetime.now(timezone.utc).isoformat()
        document["credits_after"] = current
        document["summary"] = {
            "archive_id": run_id, "archive_path": str(archive_path), "status": document["status"],
            "search_pages": sum(len(q["pages"]) for q in document["queries"]),
            "retrieved_new_posts": len(valid), "raw_new_post_ids_including_invalid_dates": len(seen),
            "unique_new_authors": len(authors), "persona_unique_authors":
                {key: len(value) for key, value in persona_authors.items()},
            "persona_posts": {key: sum(1 for q in document["queries"] for d in q["decisions"]
                                      if d.get("intent", {}).get("persona") == key)
                              for key in persona_authors},
            "text_tiers": dict(tiers), "contacted_excluded": contacted_count,
            "contacted_snapshot": document["contacted_snapshot"],
            "latest_post_at": max(latest) if latest else None,
            "stages": [{"name": q["name"], **q["counts"]} for q in document["queries"]],
            "strict_qualified": 0, "scope": "raw_review_only", "provider": "twitterapi",
            "credits_before": before, "credits_after": current,
            "observed_credits_used": sum(before.values()) - sum(current.values()),
            "credit_settlement_pending": current == before,
        }
        _save(archive_path, document)
    return document["summary"]
