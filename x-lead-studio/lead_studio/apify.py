from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from .config import APIFY_CACHE_DIR, Settings
from .discovery import candidate_from_tweet
from .targeting import SEARCH_SEGMENTS


TERMINAL_RUN_STATUSES = {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}


def build_actor_input(configuration: dict[str, Any]) -> dict[str, Any]:
    selected = {
        str(segment)
        for segment in configuration.get("segments", [])
        if str(segment) in {item.key for item in SEARCH_SEGMENTS}
    }
    segments = [segment for segment in SEARCH_SEGMENTS if segment.key in selected]
    if not segments:
        raise ValueError("No supported audience segment was selected.")

    lookback_days = max(1, min(90, int(configuration.get("lookbackDays", 30))))
    since = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).date().isoformat()
    result_limit = max(1, min(100, int(configuration.get("resultLimit", 40))))
    actor_limit = max(10, result_limit)
    queries: list[str] = []
    for segment in segments:
        # Keep the search photo-only. Video thumbnails produced most of the
        # reviewed false positives (people, surveillance frames, and tiny or
        # obscured pets) and are not suitable source artwork for a pillow.
        query = segment.query
        if "since:" not in query:
            query = f"{query} since:{since}"
        queries.extend((f"{query} place_country:US", query))
    per_query = max(10, math.ceil(actor_limit / len(queries)))

    return {
        "includeAccountOrigin": False,
        "includeFollowers": False,
        "includeFollowing": False,
        "includeListFollowers": False,
        "includeListMembers": False,
        "includeListTweets": False,
        "includeProfile": False,
        "includeReplies": False,
        "includeRetweeters": False,
        "includeTweets": False,
        "includeUserReplies": False,
        "maxItems": actor_limit,
        "maxTweetsPerQuery": per_query,
        "searchQueries": queries,
        "searchType": str(configuration.get("searchProduct", "Latest")),
        "maxTweetsPerUser": 20,
        "maxFollowersPerUser": 70,
        "maxRepliesPerTweet": 50,
        "maxRetweetersPerTweet": 55,
        "maxTweetsPerCommunity": 20,
        "maxTweetsPerList": 100,
        "maxAccountsPerList": 100,
    }


async def collect_apify_search(
    client: httpx.AsyncClient,
    settings: Settings,
    configuration: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not settings.apify_api_token:
        raise RuntimeError("Apify API token is not configured.")

    run, items = await _run_actor(
        client,
        settings,
        build_actor_input(configuration),
        dataset_limit=max(1, min(100, int(configuration.get("resultLimit", 40)))),
    )
    run_id = str(run.get("id") or "")
    dataset_id = str(run.get("defaultDatasetId") or "")
    cache_apify_items(APIFY_CACHE_DIR / f"{run_id}.json", items)

    _, preliminary = normalize_apify_items(
        items,
        run_id=run_id,
        dataset_id=dataset_id,
        us_required=bool(configuration.get("usRequired", True)),
        us_min_confidence=max(0, min(100, int(configuration.get("usMinConfidence", 70)))),
    )
    handles = sorted({candidate["author_handle"] for candidate in preliminary})
    profiles: dict[str, dict[str, Any]] = {}
    profile_run_id = ""
    if handles:
        profile_run, profile_items = await _run_actor(
            client,
            settings,
            build_profile_input(handles),
            dataset_limit=len(handles),
        )
        profile_run_id = str(profile_run.get("id") or "")
        cache_apify_items(APIFY_CACHE_DIR / f"{profile_run_id}-profiles.json", profile_items)
        profiles = index_apify_profiles(profile_items)

    return normalize_apify_items(
        items,
        run_id=run_id,
        dataset_id=dataset_id,
        us_required=bool(configuration.get("usRequired", True)),
        us_min_confidence=max(0, min(100, int(configuration.get("usMinConfidence", 70)))),
        profiles=profiles,
        profile_run_id=profile_run_id,
    )


async def _run_actor(
    client: httpx.AsyncClient,
    settings: Settings,
    actor_input: dict[str, Any],
    *,
    dataset_limit: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    response = await client.post(
        f"https://api.apify.com/v2/acts/{settings.apify_actor_id}/runs",
        params={
            "token": settings.apify_api_token,
            "waitForFinish": 60,
            "maxTotalChargeUsd": settings.apify_max_charge_usd,
        },
        json=actor_input,
    )
    if response.status_code in {401, 403}:
        raise RuntimeError("Apify authorization failed.")
    response.raise_for_status()
    run = (response.json() or {}).get("data") or {}
    run_id = str(run.get("id") or "")
    if not run_id:
        raise RuntimeError("Apify did not return a run ID.")

    for _ in range(5):
        status = str(run.get("status") or "").upper()
        if status in TERMINAL_RUN_STATUSES:
            break
        response = await client.get(
            f"https://api.apify.com/v2/actor-runs/{run_id}",
            params={"token": settings.apify_api_token, "waitForFinish": 60},
        )
        if response.status_code in {401, 403}:
            raise RuntimeError("Apify authorization failed.")
        response.raise_for_status()
        run = (response.json() or {}).get("data") or {}

    status = str(run.get("status") or "").upper()
    if status != "SUCCEEDED":
        raise RuntimeError(f"Apify run ended with status {status or 'UNKNOWN'}.")
    dataset_id = str(run.get("defaultDatasetId") or "")
    if not dataset_id:
        raise RuntimeError("Apify run did not return a dataset ID.")

    response = await client.get(
        f"https://api.apify.com/v2/datasets/{dataset_id}/items",
        params={
            "token": settings.apify_api_token,
            "format": "json",
            "clean": "true",
            "limit": max(1, min(100, dataset_limit)),
        },
    )
    if response.status_code in {401, 403}:
        raise RuntimeError("Apify dataset authorization failed.")
    response.raise_for_status()
    items = response.json()
    if not isinstance(items, list):
        raise RuntimeError("Apify dataset returned an unexpected payload.")

    return run, items


def build_profile_input(handles: list[str]) -> dict[str, Any]:
    return {
        "handles": handles,
        "includeProfile": True,
        "includeAccountOrigin": True,
        "includeTweets": False,
        "includeUserReplies": False,
        "includeFollowers": False,
        "includeFollowing": False,
        "includeReplies": False,
        "includeRetweeters": False,
        "includeListTweets": False,
        "includeListMembers": False,
        "includeListFollowers": False,
        "maxItems": 10,
    }


def normalize_apify_items(
    items: list[dict[str, Any]],
    *,
    run_id: str,
    dataset_id: str,
    us_required: bool,
    us_min_confidence: int,
    profiles: dict[str, dict[str, Any]] | None = None,
    profile_run_id: str = "",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    candidates: dict[str, dict[str, Any]] = {}
    for item in items:
        tweet = apify_item_to_tweet(
            item,
            run_id=run_id,
            dataset_id=dataset_id,
            profile=(profiles or {}).get(str(item.get("authorHandle") or "").casefold()),
            profile_run_id=profile_run_id,
        )
        if not tweet:
            continue
        candidate = candidate_from_tweet(
            tweet,
            segment_for_apify_item(item),
            us_required=us_required,
            us_min_confidence=us_min_confidence,
        )
        if candidate:
            candidates[candidate["post_id"]] = candidate
    return items, list(candidates.values())


def apify_item_to_tweet(
    item: dict[str, Any],
    *,
    run_id: str,
    dataset_id: str,
    profile: dict[str, Any] | None = None,
    profile_run_id: str = "",
) -> dict[str, Any] | None:
    post_id = str(item.get("tweetId") or "").strip()
    handle = str(item.get("authorHandle") or "").strip().lstrip("@")
    if not post_id or not handle or item.get("isRetweet") or item.get("isReply"):
        return None

    photos = item.get("photos") if isinstance(item.get("photos"), list) else []
    media_url = _first_photo_url(photos)
    if not media_url:
        return None

    return {
        "id": post_id,
        "rawContent": str(item.get("text") or ""),
        "date": str(item.get("createdAt") or ""),
        "likeCount": item.get("likes"),
        "replyCount": item.get("replies"),
        "retweetCount": item.get("retweets"),
        "viewCount": item.get("views"),
        "media": {"photos": [{"url": media_url}]},
        "user": {
            "username": handle,
            "followersCount": (profile or {}).get("followers", item.get("authorFollowers")),
            "verified": bool((profile or {}).get("verified", item.get("authorVerified"))),
            "rawDescription": str((profile or {}).get("bio") or ""),
            "location": str((profile or {}).get("location") or ""),
            "accountBasedIn": str((profile or {}).get("accountBasedIn") or ""),
        },
        "_source_metadata": {
            "provider": "apify",
            "run_id": run_id,
            "dataset_id": dataset_id,
            "search_query": str(item.get("searchQuery") or "")[:1000],
            "post_text": str(item.get("text") or "")[:1500],
            "author_name": str(item.get("authorName") or "")[:200],
            "profile_run_id": profile_run_id,
            "media_kind": "photo",
            "photo_count": len(photos),
        },
    }


def index_apify_profiles(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        str(item.get("handle") or "").casefold(): item
        for item in items
        if item.get("type") == "profile" and str(item.get("handle") or "").strip()
    }


def segment_for_apify_item(item: dict[str, Any]) -> str:
    source = f"{item.get('searchQuery') or ''} {item.get('text') or ''}".casefold()
    if "birthday" in source or "barkday" in source or "turns one" in source:
        return "pet_birthday"
    if "adopt" in source or "gotcha day" in source or "welcome home" in source:
        return "new_adoption"
    return "custom"


def cache_apify_items(path: Path, items: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


def _first_photo_url(photos: list[Any]) -> str | None:
    for photo in photos:
        value = photo if isinstance(photo, str) else photo.get("url") if isinstance(photo, dict) else None
        if isinstance(value, str) and value.startswith("https://"):
            return value
    return None
