from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .targeting import build_targeting, candidate_status
from .xclient import read


def candidate_from_tweet(
    tweet: dict[str, Any],
    source_segment: str,
    *,
    us_required: bool,
    us_min_confidence: int,
) -> dict[str, Any] | None:
    media = tweet.get("media") or {}
    photos = media.get("photos") or []
    if not photos:
        return None
    photo = photos[0]
    media_url = photo.get("url") if isinstance(photo, dict) else None
    user = tweet.get("user") or tweet.get("author") or {}
    username = user.get("username") or user.get("login")
    post_id = str(tweet.get("id") or tweet.get("id_str") or "")
    if not media_url or not username or not post_id:
        return None

    targeting = build_targeting(tweet, source_segment)
    status = candidate_status(targeting, us_required, us_min_confidence)
    stored_targeting = {
        "matched_terms": targeting["matched_terms"],
        "ownership_terms": targeting["ownership_terms"],
        "organization": targeting["organization"],
        "advertisement": targeting["advertisement"],
        "promotion_terms": targeting["promotion_terms"],
        "pet_type": targeting["pet_type"],
        "post_excerpt": text_excerpt(tweet),
    }
    source_metadata = tweet.get("_source_metadata")
    if isinstance(source_metadata, dict):
        stored_targeting["source"] = source_metadata
    raw_posted_at = tweet.get("date") or tweet.get("created_at")
    posted_at = raw_posted_at.isoformat() if isinstance(raw_posted_at, datetime) else str(raw_posted_at or "")
    if posted_at and "T" not in posted_at and " " in posted_at:
        posted_at = posted_at.replace(" ", "T", 1)
    return {
        "post_id": post_id,
        "author_hash": hashlib.sha256(str(username).lower().encode()).hexdigest(),
        "author_handle": str(username),
        "media_url": str(media_url),
        "post_url": f"https://x.com/{username}/status/{post_id}",
        "posted_at": posted_at or None,
        "status": status,
        "segment": targeting["segment"],
        "occasion": targeting["occasion"],
        "pet_type": targeting["pet_type"],
        "occasion_confidence": targeting["occasion_confidence"],
        "ownership_confidence": targeting["ownership_confidence"],
        "us_confidence": targeting["us_confidence"],
        "us_evidence": targeting["us_evidence"],
        "organization": int(targeting["organization"]),
        "advertisement": int(targeting["advertisement"]),
        "like_count": targeting["like_count"],
        "reply_count": targeting["reply_count"],
        "repost_count": targeting["repost_count"],
        "view_count": targeting["view_count"],
        "followers_count": targeting["followers_count"],
        "engagement_quality": targeting["engagement_quality"],
        "account_quality": targeting["account_quality"],
        "recency_score": targeting["recency_score"],
        "targeting_json": json.dumps(stored_targeting, ensure_ascii=False),
    }


def text_excerpt(tweet: dict[str, Any]) -> str:
    return str(tweet.get("rawContent") or tweet.get("text") or tweet.get("full_text") or "")[:1500]


async def collect_search(
    query: str,
    product: str,
    limit: int,
    source_segment: str,
    *,
    cookie_path: Path,
    lookback_days: int,
    us_required: bool,
    us_min_confidence: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if "since:" not in query:
        since = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).date().isoformat()
        query = f"{query} since:{since}"
    if "-filter:retweets" not in query and "-is:retweet" not in query:
        query = f"{query} -filter:retweets"
    items = await read("search", {"q": query, "kv": {"product": product}}, limit, cookie_path)
    candidates = [
        candidate
        for item in items
        if (
            candidate := candidate_from_tweet(
                item,
                source_segment,
                us_required=us_required,
                us_min_confidence=us_min_confidence,
            )
        )
    ]
    return items, candidates
