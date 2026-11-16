"""Join a text demand post to a verified photo posted by the same X account."""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from .config import Settings, TWITTERAPI_ARCHIVE_DIR
from .purchase_intent import EXCLUSIONS
from .targeting import build_targeting
from .twitterapi import _request_page, twitterapi_item_to_tweet


def _photo_source(tweet: dict[str, Any]) -> dict[str, Any]:
    author = tweet.get("author") or {}
    handle = str(author.get("username") or "")
    post_id = str(tweet.get("id") or "")
    return {
        "post_id": post_id,
        "post_url": f"https://x.com/{handle}/status/{post_id}",
        "post_excerpt": str(tweet.get("rawContent") or "")[:500],
        "posted_at": tweet.get("date") or None,
        "author_id": str(author.get("id") or ""),
        "author_handle": handle,
    }


def _save_archive(path: Path, archive: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".part")
    temporary.write_text(json.dumps(archive, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


async def attach_same_account_photo(
    candidate: dict[str, Any], client: httpx.AsyncClient, settings: Settings,
    *, archive_id: str, archive_dir: Path = TWITTERAPI_ARCHIVE_DIR,
) -> tuple[dict[str, Any] | None, dict[str, dict[str, Any]]]:
    """Return up to four photo URLs with per-URL source proof; no match means no lead."""
    post_id = str(candidate.get("post_id") or "")
    handle = str(candidate.get("author_handle") or "")
    author_id = str(candidate.get("author_id") or "")
    existing = [url for url in candidate.get("media_urls") or [] if isinstance(url, str) and url.startswith("https://")]
    if existing:
        source = {
            "post_id": post_id, "post_url": candidate["post_url"],
            "post_excerpt": json.loads(candidate.get("targeting_json") or "{}").get("post_excerpt", ""),
            "posted_at": candidate.get("posted_at"), "author_id": author_id,
            "author_handle": handle,
        }
        return candidate, {url: source for url in existing}
    if not author_id or not re.fullmatch(r"[A-Za-z0-9_]{1,15}", handle):
        return None, {}

    # One bounded account search. Each provider response is persisted before filtering.
    query = f"from:{handle} filter:images -filter:replies -filter:retweets"
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "-", archive_id).strip("-._")[:80] or "unknown"
    path = archive_dir / f"{safe_id}-photo-{post_id}-{uuid.uuid4().hex[:8]}.json"
    archive: dict[str, Any] = {
        "version": 1, "demand_post_id": post_id, "author_id": author_id,
        "query": query, "requested_at": datetime.now(timezone.utc).isoformat(),
        "response": None,
    }
    _save_archive(path, archive)
    payload = await _request_page(client, settings, query, "")
    archive["response"] = payload
    _save_archive(path, archive)

    sources: dict[str, dict[str, Any]] = {}
    for item in (payload.get("tweets") or [])[:30]:
        if not isinstance(item, dict):
            continue
        if item.get("isQuote") or item.get("quotedTweet") or item.get("quoted_tweet"):
            continue
        tweet = twitterapi_item_to_tweet(item, search_query=query)
        if not tweet or str(tweet["id"]) == post_id:
            continue
        author = tweet["author"]
        if str(author.get("id") or "") != author_id or str(author.get("username") or "").casefold() != handle.casefold():
            continue
        screening = build_targeting(tweet, "custom")
        if screening["organization"] or screening["advertisement"]:
            continue
        photo_text = str(tweet.get("rawContent") or "")
        if any(re.search(pattern, photo_text, re.I) for pattern in EXCLUSIONS.values()):
            continue
        for photo in tweet["media"]["photos"]:
            url = photo["url"]
            if url not in sources:
                sources[url] = _photo_source(tweet)
            if len(sources) == 4:
                break
        if len(sources) == 4:
            break
    if not sources:
        return None, {}
    return {**candidate, "media_url": next(iter(sources)), "media_urls": list(sources)}, sources


def record_verified_photo_source(
    candidate: dict[str, Any], sources: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    source = sources.get(str(candidate.get("media_url") or ""))
    if not source:
        return None
    targeting = json.loads(candidate.get("targeting_json") or "{}")
    verification = targeting.get("image_verification") or {}
    if verification.get("result") != "verified" or verification.get("media_url") != candidate["media_url"]:
        return None
    targeting["photo_source"] = {
        **source, "relationship": "same_post" if source["post_id"] == candidate["post_id"] else "same_account",
        "selected_media_url": candidate["media_url"], "verification_result": "verified",
    }
    return {**candidate, "targeting_json": json.dumps(targeting, ensure_ascii=False)}
