from __future__ import annotations

import asyncio
import json
import math
import re
import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable

import httpx

from .config import (
    Settings,
    TWITTERAPI_ABOUT_CACHE_PATH,
    TWITTERAPI_ARCHIVE_DIR,
    TWITTERAPI_STATE_PATH,
)
from .discovery import candidate_from_tweet
from .targeting import SEARCH_SEGMENTS, SearchSegment


ADVANCED_SEARCH_PATH = "/twitter/tweet/advanced_search"
USER_ABOUT_PATH = "/twitter/user_about"
RETRYABLE_STATUS_CODES = {429, 500, 502, 503}


class TwitterApiError(RuntimeError):
    pass


class TwitterApiCreditsExhausted(TwitterApiError):
    pass


@dataclass
class CollectionMetrics:
    provider: str = "twitterapi"
    query_product: str = "Latest"
    query_count: int = 0
    page_count: int = 0
    received_posts: int = 0
    archived_posts: int = 0
    archive_id: str = ""
    unique_posts: int = 0
    duplicate_posts: int = 0
    photo_posts: int = 0
    candidate_posts: int = 0
    new_status: int = 0
    location_review_status: int = 0
    targeting_review_status: int = 0
    rejected_targeting_status: int = 0
    reallocated_broad_limit: int = 0
    about_candidates: int = 0
    about_cache_hits: int = 0
    about_api_calls: int = 0
    about_us_accounts: int = 0
    about_non_us_accounts: int = 0
    about_missing_accounts: int = 0
    query_modes: dict[str, int] = field(default_factory=lambda: {"us": 0, "broad": 0})

    def as_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "query_product": self.query_product,
            "query_count": self.query_count,
            "page_count": self.page_count,
            "received_posts": self.received_posts,
            "archived_posts": self.archived_posts,
            "archive_id": self.archive_id,
            "unique_posts": self.unique_posts,
            "duplicate_posts": self.duplicate_posts,
            "photo_posts": self.photo_posts,
            "candidate_posts": self.candidate_posts,
            "new_status": self.new_status,
            "location_review_status": self.location_review_status,
            "targeting_review_status": self.targeting_review_status,
            "rejected_targeting_status": self.rejected_targeting_status,
            "reallocated_broad_limit": self.reallocated_broad_limit,
            "about_candidates": self.about_candidates,
            "about_cache_hits": self.about_cache_hits,
            "about_api_calls": self.about_api_calls,
            "about_us_accounts": self.about_us_accounts,
            "about_non_us_accounts": self.about_non_us_accounts,
            "about_missing_accounts": self.about_missing_accounts,
            "query_modes": self.query_modes,
        }


@dataclass(frozen=True)
class QueryPlan:
    segment: SearchSegment
    mode: str
    limit: int
    since_time: int
    until_time: int

    @property
    def state_key(self) -> str:
        return f"{self.segment.key}:{self.mode}"

    @property
    def query(self) -> str:
        base = self.segment.query
        if "-filter:retweets" not in base and "-is:retweet" not in base:
            base = f"{base} -filter:retweets"
        if self.mode == "us":
            base = f"{base} place_country:US"
        return f"{base} since_time:{self.since_time} until_time:{self.until_time}"


async def collect_twitterapi_search(
    client: httpx.AsyncClient,
    settings: Settings,
    configuration: dict[str, Any],
    *,
    state_path: Path = TWITTERAPI_STATE_PATH,
    archive_id: str | None = None,
    archive_dir: Path | None = None,
    about_cache_path: Path | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    if not settings.twitterapi_api_key:
        raise TwitterApiError("TwitterAPI.io API key is not configured.")

    archive_root = archive_dir or (
        TWITTERAPI_ARCHIVE_DIR if state_path == TWITTERAPI_STATE_PATH else state_path.parent / "runs"
    )
    archive_path = _new_archive_path(archive_root, archive_id)
    archive: dict[str, Any] = {
        "archive_version": 1,
        "provider": "twitterapi",
        "archive_id": archive_path.stem,
        "status": "collecting",
        "started_at": _utc_now(),
        "configuration": _archive_configuration(configuration),
        "queries": [],
    }
    _save_archive(archive_path, archive)

    state = _load_state(state_path)
    plans = build_query_plan(
        configuration,
        state=state,
        us_share=settings.twitterapi_us_query_share,
        include_geo=settings.twitterapi_geo_query_enabled,
    )
    metrics = CollectionMetrics(archive_id=archive_path.stem)
    raw_by_id: dict[str, dict[str, Any]] = {}
    tweets_by_id: dict[str, tuple[dict[str, Any], str]] = {}
    candidates: dict[str, dict[str, Any]] = {}
    completed_watermarks: dict[str, int] = {}
    us_shortfall_by_segment: dict[str, int] = {}

    try:
        for plan in plans:
            effective_plan = plan
            if plan.mode == "broad":
                shortfall = us_shortfall_by_segment.get(plan.segment.key, 0)
                if shortfall:
                    effective_plan = replace(plan, limit=plan.limit + shortfall)
                    metrics.reallocated_broad_limit += shortfall
            metrics.query_count += 1
            metrics.query_modes[plan.mode] += 1
            query_archive: dict[str, Any] = {
                "segment": plan.segment.key,
                "mode": plan.mode,
                "limit": effective_plan.limit,
                "query": effective_plan.query,
                "pages": [],
            }
            archive["queries"].append(query_archive)
            _save_archive(archive_path, archive)

            def archive_page(cursor: str, payload: dict[str, Any]) -> None:
                tweets = payload.get("tweets") or []
                raw_count = len(tweets) if isinstance(tweets, list) else 0
                query_archive["pages"].append(
                    {
                        "cursor": cursor,
                        "received_at": _utc_now(),
                        "response": payload,
                    }
                )
                metrics.archived_posts += raw_count
                _save_archive(archive_path, archive)

            items, pages = await _search_query(client, settings, effective_plan, page_sink=archive_page)
            if plan.mode == "us":
                us_shortfall_by_segment[plan.segment.key] = max(0, plan.limit - len(items))
            metrics.page_count += pages
            metrics.received_posts += len(items)
            for item in items:
                post_id = str(item.get("id") or item.get("id_str") or "").strip()
                if not post_id or post_id in raw_by_id:
                    metrics.duplicate_posts += 1
                    continue
                raw_by_id[post_id] = item
                tweet = twitterapi_item_to_tweet(item, search_query=plan.query)
                if not tweet:
                    continue
                metrics.photo_posts += 1
                preliminary = candidate_from_tweet(
                    tweet,
                    plan.segment.key,
                    us_required=bool(configuration.get("usRequired", True)),
                    us_min_confidence=max(0, min(100, int(configuration.get("usMinConfidence", 70)))),
                )
                if not preliminary or preliminary.get("pet_type") not in {"cat", "dog"}:
                    continue
                tweets_by_id[post_id] = (tweet, plan.segment.key)
            # Advance only after every page for this query completed successfully.
            # Keep a five-minute overlap to absorb indexing delay without repeatedly
            # scanning the full lookback window.
            completed_watermarks[plan.state_key] = max(plan.since_time, plan.until_time - 300)
    except Exception as error:
        archive["status"] = "partial"
        archive["failed_at"] = _utc_now()
        archive["error_type"] = type(error).__name__
        _save_archive(archive_path, archive)
        raise

    if settings.twitterapi_about_enrichment_enabled and bool(configuration.get("usRequired", True)):
        resolved_cache_path = about_cache_path or (
            TWITTERAPI_ABOUT_CACHE_PATH
            if state_path == TWITTERAPI_STATE_PATH
            else state_path.parent / "user-about-cache.json"
        )
        try:
            await _enrich_tweets_with_user_about(
                client,
                settings,
                tweets_by_id,
                configuration,
                resolved_cache_path,
                metrics,
                archive,
                archive_path,
            )
        except Exception as error:
            archive["status"] = "partial"
            archive["failed_at"] = _utc_now()
            archive["error_type"] = type(error).__name__
            _save_archive(archive_path, archive)
            raise

    for tweet, segment_key in tweets_by_id.values():
        candidate = candidate_from_tweet(
            tweet,
            segment_key,
            us_required=bool(configuration.get("usRequired", True)),
            us_min_confidence=max(0, min(100, int(configuration.get("usMinConfidence", 70)))),
        )
        if candidate and candidate.get("pet_type") in {"cat", "dog"}:
            candidates[candidate["post_id"]] = candidate

    try:
        state.update(completed_watermarks)
        _save_state(state_path, state)
    except Exception as error:
        archive["status"] = "partial"
        archive["failed_at"] = _utc_now()
        archive["error_type"] = type(error).__name__
        _save_archive(archive_path, archive)
        raise
    metrics.unique_posts = len(raw_by_id)
    metrics.candidate_posts = len(candidates)
    for candidate in candidates.values():
        status = str(candidate.get("status") or "")
        if status == "new":
            metrics.new_status += 1
        elif status == "location_review":
            metrics.location_review_status += 1
        elif status == "targeting_review":
            metrics.targeting_review_status += 1
        elif status == "rejected_targeting":
            metrics.rejected_targeting_status += 1
    archive["status"] = "completed"
    archive["completed_at"] = _utc_now()
    archive["metrics"] = metrics.as_dict()
    _save_archive(archive_path, archive)
    return list(raw_by_id.values()), list(candidates.values()), metrics.as_dict()


def build_query_plan(
    configuration: dict[str, Any],
    *,
    state: dict[str, int] | None = None,
    us_share: int = 90,
    include_geo: bool = True,
    now: datetime | None = None,
) -> list[QueryPlan]:
    selected = {str(value) for value in configuration.get("segments", [])}
    segments = [segment for segment in SEARCH_SEGMENTS if segment.key in selected]
    if not segments:
        raise ValueError("No supported audience segment was selected.")

    current = now or datetime.now(timezone.utc)
    until_time = int(current.timestamp())
    lookback_days = max(1, min(90, int(configuration.get("lookbackDays", 30))))
    initial_since = int((current - timedelta(days=lookback_days)).timestamp())
    total_limit = max(1, min(100, int(configuration.get("resultLimit", 40))))
    product = str(configuration.get("searchProduct", "Latest"))
    if product != "Latest":
        # TwitterAPI.io exposes Latest and Top; acquisition always uses Latest
        # so old high-engagement posts do not consume the discovery budget.
        configuration["searchProduct"] = "Latest"

    per_segment = _split_limit(total_limit, len(segments))
    plans: list[QueryPlan] = []
    watermarks = state or {}
    share = max(50, min(100, us_share))
    for segment, segment_limit in zip(segments, per_segment, strict=True):
        if not include_geo:
            key = f"{segment.key}:broad"
            since_time = max(initial_since, int(watermarks.get(key, initial_since)))
            plans.append(QueryPlan(segment, "broad", segment_limit, since_time, until_time))
            continue
        us_limit = max(1, math.ceil(segment_limit * share / 100))
        if share < 100 and segment_limit > 1:
            us_limit = min(segment_limit - 1, us_limit)
        broad_limit = segment_limit - us_limit
        modes = [("us", us_limit)]
        if broad_limit > 0:
            modes.append(("broad", broad_limit))
        for mode, limit in modes:
            key = f"{segment.key}:{mode}"
            since_time = max(initial_since, int(watermarks.get(key, initial_since)))
            plans.append(QueryPlan(segment, mode, limit, since_time, until_time))
    return plans


async def _enrich_tweets_with_user_about(
    client: httpx.AsyncClient,
    settings: Settings,
    tweets_by_id: dict[str, tuple[dict[str, Any], str]],
    configuration: dict[str, Any],
    cache_path: Path,
    metrics: CollectionMetrics,
    archive: dict[str, Any],
    archive_path: Path,
) -> None:
    us_min_confidence = max(0, min(100, int(configuration.get("usMinConfidence", 70))))
    cache = _load_about_cache(cache_path)
    cache_accounts = cache.setdefault("accounts", {})
    max_age = timedelta(days=settings.twitterapi_about_cache_days)
    tweets_by_handle: dict[str, list[dict[str, Any]]] = {}
    for tweet, segment_key in tweets_by_id.values():
        preliminary = candidate_from_tweet(
            tweet,
            segment_key,
            us_required=True,
            us_min_confidence=us_min_confidence,
        )
        if not preliminary:
            continue
        author = tweet.get("author") if isinstance(tweet.get("author"), dict) else {}
        handle = str(author.get("username") or "").strip().lstrip("@").casefold()
        cached = cache_accounts.get(handle)
        has_fresh_cache = isinstance(cached, dict) and _about_cache_entry_is_fresh(cached, max_age)
        if handle and (has_fresh_cache or _needs_about_lookup(preliminary, us_min_confidence)):
            tweets_by_handle.setdefault(handle, []).append(tweet)

    metrics.about_candidates = len(tweets_by_handle)
    if not tweets_by_handle:
        return

    archive_entries: list[dict[str, Any]] = []
    archive["user_about_enrichment"] = archive_entries

    for handle, tweets in sorted(tweets_by_handle.items()):
        cached = cache_accounts.get(handle)
        from_cache = isinstance(cached, dict) and _about_cache_entry_is_fresh(cached, max_age)
        if from_cache:
            entry = cached
            metrics.about_cache_hits += 1
        else:
            metrics.about_api_calls += 1
            entry = await _request_user_about(client, settings, handle)
            cache_accounts[handle] = entry
            _save_about_cache(cache_path, cache)

        account_based_in = str(entry.get("account_based_in") or "").strip()
        location_accurate = entry.get("location_accurate")
        if account_based_in.casefold() in {"united states", "united states of america", "usa", "us", "u.s.", "u.s.a."}:
            metrics.about_us_accounts += 1
        elif account_based_in:
            metrics.about_non_us_accounts += 1
        else:
            metrics.about_missing_accounts += 1

        archive_entries.append(
            {
                "handle": handle,
                "source": "cache" if from_cache else "api",
                "account_based_in": account_based_in or None,
                "location_accurate": location_accurate if isinstance(location_accurate, bool) else None,
            }
        )
        for tweet in tweets:
            author = tweet.get("author") if isinstance(tweet.get("author"), dict) else {}
            if account_based_in:
                author["accountBasedIn"] = account_based_in
            if isinstance(location_accurate, bool):
                author["accountBasedInAccurate"] = location_accurate
            source = tweet.get("_source_metadata") if isinstance(tweet.get("_source_metadata"), dict) else {}
            source["location_enrichment"] = "twitterapi_user_about"
            source["account_based_in"] = account_based_in or None
            source["account_based_in_accurate"] = location_accurate if isinstance(location_accurate, bool) else None

        _save_archive(archive_path, archive)


def _needs_about_lookup(candidate: dict[str, Any], us_min_confidence: int) -> bool:
    if int(candidate.get("us_confidence") or 0) >= us_min_confidence:
        return False
    evidence = str(candidate.get("us_evidence") or "")
    return evidence in {"no_public_location", "profile_location_unresolved"}


async def _request_user_about(
    client: httpx.AsyncClient,
    settings: Settings,
    handle: str,
) -> dict[str, Any]:
    for attempt in range(4):
        response = await client.get(
            f"{settings.twitterapi_base_url}{USER_ABOUT_PATH}",
            headers={"X-API-Key": settings.twitterapi_api_key},
            params={"userName": handle},
        )
        if response.status_code == 402:
            raise TwitterApiCreditsExhausted("TwitterAPI.io credits are exhausted during user_about enrichment.")
        if response.status_code in {401, 403}:
            raise TwitterApiError("TwitterAPI.io authorization failed during user_about enrichment.")
        if response.status_code == 404:
            return _new_about_cache_entry()
        if response.status_code in RETRYABLE_STATUS_CODES and attempt < 3:
            await asyncio.sleep(2**attempt)
            continue
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise TwitterApiError("TwitterAPI.io returned an invalid user_about response.")
        if str(payload.get("status") or "").lower() != "success":
            return _new_about_cache_entry()
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        about = data.get("about_profile") if isinstance(data.get("about_profile"), dict) else {}
        return _new_about_cache_entry(
            account_based_in=_about_location_value(about.get("account_based_in")),
            location_accurate=_optional_bool(about.get("location_accurate")),
        )
    raise TwitterApiError("TwitterAPI.io user_about request failed after retries.")


def _about_location_value(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("value") or value.get("name") or ""
    return str(value or "").strip()[:100]


def _optional_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.casefold() in {"true", "false"}:
        return value.casefold() == "true"
    return None


def _new_about_cache_entry(
    *,
    account_based_in: str = "",
    location_accurate: bool | None = None,
) -> dict[str, Any]:
    return {
        "account_based_in": account_based_in,
        "location_accurate": location_accurate,
        "fetched_at": _utc_now(),
    }


def _load_about_cache(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {"version": 1, "accounts": {}}
    accounts = value.get("accounts") if isinstance(value, dict) else None
    return {"version": 1, "accounts": accounts if isinstance(accounts, dict) else {}}


def _save_about_cache(path: Path, cache: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(cache, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    temporary.replace(path)


def _about_cache_entry_is_fresh(entry: dict[str, Any], max_age: timedelta) -> bool:
    try:
        fetched_at = datetime.fromisoformat(str(entry.get("fetched_at") or "").replace("Z", "+00:00"))
    except ValueError:
        return False
    if fetched_at.tzinfo is None:
        fetched_at = fetched_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - fetched_at.astimezone(timezone.utc) <= max_age


async def _search_query(
    client: httpx.AsyncClient,
    settings: Settings,
    plan: QueryPlan,
    *,
    page_sink: Callable[[str, dict[str, Any]], None] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    collected: list[dict[str, Any]] = []
    cursor = ""
    previous_cursor = None
    pages = 0
    while len(collected) < plan.limit:
        payload = await _request_page(client, settings, plan.query, cursor)
        pages += 1
        if page_sink:
            page_sink(cursor, payload)
        tweets = payload.get("tweets") or []
        if not isinstance(tweets, list):
            raise TwitterApiError("TwitterAPI.io returned an invalid tweets payload.")
        collected.extend(item for item in tweets if isinstance(item, dict))
        next_cursor = str(payload.get("next_cursor") or "")
        if not payload.get("has_next_page") or not next_cursor or next_cursor == cursor or next_cursor == previous_cursor:
            break
        previous_cursor, cursor = cursor, next_cursor
    return collected[: plan.limit], pages


async def _request_page(
    client: httpx.AsyncClient,
    settings: Settings,
    query: str,
    cursor: str,
) -> dict[str, Any]:
    for attempt in range(4):
        response = await client.get(
            f"{settings.twitterapi_base_url}{ADVANCED_SEARCH_PATH}",
            headers={"X-API-Key": settings.twitterapi_api_key},
            params={"query": query, "queryType": "Latest", "cursor": cursor},
        )
        if response.status_code == 402:
            raise TwitterApiCreditsExhausted("TwitterAPI.io credits are exhausted.")
        if response.status_code in {401, 403}:
            raise TwitterApiError("TwitterAPI.io authorization failed.")
        if response.status_code in RETRYABLE_STATUS_CODES and attempt < 3:
            await asyncio.sleep(2**attempt)
            continue
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise TwitterApiError("TwitterAPI.io returned an invalid response.")
        if str(payload.get("status") or "").lower() == "error":
            raise TwitterApiError(str(payload.get("message") or "TwitterAPI.io returned an error."))
        return payload
    raise TwitterApiError("TwitterAPI.io request failed after retries.")


def twitterapi_item_to_tweet(item: dict[str, Any], *, search_query: str) -> dict[str, Any] | None:
    post_id = str(item.get("id") or item.get("id_str") or "").strip()
    author = item.get("author") if isinstance(item.get("author"), dict) else {}
    handle = str(author.get("userName") or author.get("username") or "").strip().lstrip("@")
    if not post_id or not handle or item.get("isRetweet") or item.get("isReply"):
        return None
    photos = _photo_urls(item)
    if not photos:
        return None
    return {
        "id": post_id,
        "rawContent": str(item.get("text") or ""),
        "date": _iso_datetime(item.get("createdAt") or item.get("created_at")),
        "likeCount": item.get("likeCount") or item.get("like_count"),
        "replyCount": item.get("replyCount") or item.get("reply_count"),
        "retweetCount": item.get("retweetCount") or item.get("retweet_count"),
        "viewCount": item.get("viewCount") or item.get("view_count"),
        "media": {"photos": [{"url": url} for url in photos]},
        "author": {
            "username": handle,
            "followersCount": author.get("followers") or author.get("followersCount"),
            "verified": bool(author.get("isBlueVerified") or author.get("verified")),
            "description": str(author.get("description") or ""),
            "location": str(author.get("location") or ""),
        },
        "place": item.get("place") if isinstance(item.get("place"), dict) else {},
        "_source_metadata": {
            "provider": "twitterapi",
            "search_query": search_query[:1500],
            "post_text": str(item.get("text") or "")[:1500],
            "media_kind": "photo",
            "photo_count": len(photos),
        },
    }


def _photo_urls(item: dict[str, Any]) -> list[str]:
    containers: list[Any] = []
    media = item.get("media")
    if isinstance(media, dict):
        containers.extend(media.get("photos") or [])
    elif isinstance(media, list):
        containers.extend(media)
    for key in ("extendedEntities", "extended_entities", "entities"):
        value = item.get(key)
        if isinstance(value, dict):
            containers.extend(value.get("media") or [])
    urls: list[str] = []
    for entry in containers:
        if not isinstance(entry, dict):
            continue
        media_type = str(entry.get("type") or "photo").lower()
        if media_type not in {"photo", "image"}:
            continue
        url = str(
            entry.get("media_url_https")
            or entry.get("mediaUrl")
            or entry.get("media_url")
            or entry.get("url")
            or ""
        ).strip()
        if url.startswith("https://") and not url.startswith("https://t.co/") and url not in urls:
            urls.append(url)
    return urls


def _iso_datetime(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(raw)
        except (TypeError, ValueError):
            return raw
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def _split_limit(total: int, count: int) -> list[int]:
    base, remainder = divmod(total, count)
    return [base + (1 if index < remainder else 0) for index in range(count)]


def _load_state(path: Path) -> dict[str, int]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    if not isinstance(value, dict):
        return {}
    return {str(key): int(item) for key, item in value.items() if isinstance(item, int)}


def _save_state(path: Path, state: dict[str, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
    temporary.replace(path)


def _archive_configuration(configuration: dict[str, Any]) -> dict[str, Any]:
    allowed = ("segments", "searchProduct", "resultLimit", "lookbackDays", "usRequired", "usMinConfidence")
    return {key: configuration[key] for key in allowed if key in configuration}


def _new_archive_path(directory: Path, requested_id: str | None) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", str(requested_id or "")).strip("-._")
    if not stem:
        stem = f"{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}"
    candidate = directory / f"{stem}.json"
    if not candidate.exists():
        return candidate
    return directory / f"{stem}-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}.json"


def _save_archive(path: Path, archive: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(archive, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
