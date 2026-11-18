"""Bounded, read-only raw TwitterAPI recall probe; never imports or sends leads."""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
from urllib.parse import urlsplit
import uuid
from typing import Any

import httpx

from lead_studio.config import Settings, TWITTERAPI_ARCHIVE_DIR
from lead_studio.purchase_intent import assess_purchase_intent, needs_reply_parent_context
from lead_studio.twitterapi import _iso_datetime


SEARCH_PATH = "/twitter/tweet/advanced_search"
CREDITS_PATH = "/oapi/my/info"
# Explicit probe-only queries. The optional control validates source freshness
# and is excluded from shopping counts. Fallbacks remove constraints.
QUERY_TIERS = (
    ("shopping_pet_product", "(dog OR cat) (gift OR pillow OR cushion OR portrait) lang:en"),
    ("buyer_recommend_pillow", "recommend pillow lang:en"),
    ("buyer_where_pillow", '"where can I buy" pillow lang:en'),
    ("shopping_pet_broad", "(dog OR cat OR pet) (gift OR pillow OR cushion OR portrait OR photo) lang:en"),
    ("shopping_product_only", "(gift OR pillow OR cushion OR portrait) lang:en"),
)
PET_BODY = re.compile(r"\b(?:dog|cat|pet|puppy|kitten)s?\b", re.I)
PRODUCT_BODY = re.compile(r"\b(?:gift|present|pillow|cushion|portrait|print|blanket|mug|custom)s?\b", re.I)


def _truncate_utf16(value: str, limit: int) -> str:
    """Match JavaScript/Zod string length while retaining full Unicode chars."""
    size = 0
    end = 0
    for char in value:
        width = 2 if ord(char) > 0xFFFF else 1
        if size + width > limit:
            break
        size += width
        end += 1
    return value[:end]


def _trusted_post_photo_url(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw or len(raw) > 2048:
        return None
    try:
        parsed = urlsplit(raw)
        if (parsed.scheme != "https" or parsed.hostname != "pbs.twimg.com"
                or parsed.username or parsed.password or parsed.port not in (None, 443)
                or not parsed.path.startswith("/media/") or parsed.path == "/media/"):
            return None
    except ValueError:
        return None
    return raw


def extract_post_photo_urls(post: dict[str, Any]) -> list[str]:
    """Only this post's explicit photo media, never video thumbs or nested posts."""
    photos: list[str] = []
    seen_paths: set[str] = set()
    media_items: list[dict[str, Any]] = []
    for key in ("extendedEntities", "extended_entities", "entities"):
        container = post.get(key)
        if isinstance(container, dict) and isinstance(container.get("media"), list):
            media_items.extend(item for item in container["media"] if isinstance(item, dict)
                              and item.get("type") == "photo")
    media = post.get("media")
    if isinstance(media, dict) and isinstance(media.get("photos"), list):
        media_items.extend(item for item in media["photos"] if isinstance(item, dict)
                           and item.get("type") in (None, "photo"))
    for item in media_items:
        url = _trusted_post_photo_url(item.get("media_url_https") or item.get("url"))
        if not url:
            continue
        path = urlsplit(url).path
        if path in seen_paths:
            continue
        seen_paths.add(path)
        photos.append(url)
        if len(photos) == 4:
            break
    return photos


class RecallProbeError(RuntimeError):
    def __init__(self, archive_path: Path, cause: Exception):
        super().__init__(f"Recall probe failed: {type(cause).__name__}")
        self.archive_path = archive_path


def _save(path: Path, document: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".part")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _nested_posts(post: Any):
    if not isinstance(post, dict):
        return
    if post.get("id") or post.get("id_str"):
        yield post
    for key in ("quoted_tweet", "quotedTweet", "retweeted_tweet", "retweetedTweet", "parent"):
        yield from _nested_posts(post.get(key))


def _response_posts(response: Any):
    if not isinstance(response, dict):
        return
    for post in response.get("tweets") or []:
        yield from _nested_posts(post)
    for key in ("tweet", "root_tweet", "rootTweet"):
        yield from _nested_posts(response.get(key))


def _archive_posts(document: dict[str, Any]):
    yield from _response_posts(document)  # Bare provider parent archives.
    yield from _response_posts(document.get("response"))
    for page in document.get("pages", []):
        yield from _response_posts(page.get("response"))
    for query in document.get("queries", []):
        for page in (*query.get("pages", []), *query.get("discussion_replies", []),
                     *query.get("parent_contexts", [])):
            yield from _response_posts(page.get("response"))


def historical_ids(archive_dir: Path) -> tuple[set[str], set[str], int]:
    """Snapshot every pre-run archive, including prior recall probes."""
    post_ids: set[str] = set()
    author_ids: set[str] = set()
    archives = 0
    for path in archive_dir.glob("*.json"):
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        archives += 1
        for post in _archive_posts(document):
            if not isinstance(post, dict):
                continue
            post_id = str(post.get("id") or post.get("id_str") or "")
            author = post.get("author") if isinstance(post.get("author"), dict) else {}
            author_id = str(author.get("id") or author.get("id_str") or author.get("userName") or "")
            if post_id:
                post_ids.add(post_id)
            if author_id:
                author_ids.add(author_id)
    return post_ids, author_ids, archives


def extract_raw_reviews(archive_paths: list[Path]) -> list[dict[str, Any]]:
    """Build review-only rows from shopping pages; never include control pages."""
    rows: dict[str, dict[str, Any]] = {}
    resolved_parents: dict[str, tuple[str, str, str]] = {}
    for path in archive_paths:
        document = json.loads(path.read_text(encoding="utf-8"))
        if document.get("kind") == "single_parent_context_query_only":
            reply_id = str(document.get("reply_post_id") or "")
            parents = (document.get("response") or {}).get("tweets") or []
            # This single parent was independently inspected as an ordinary
            # non-pet Martian pillow. Other parent archives are not decisions.
            if (reply_id == "2122748134531166384" and
                    str(document.get("parent_post_id")) == "2122672037684486452" and
                    parents and isinstance(parents[0], dict)):
                parent = parents[0]
                urls = (parent.get("entities") or {}).get("urls") or []
                expanded = [str(url.get("expanded_url")) for url in urls
                            if isinstance(url, dict) and url.get("expanded_url")]
                resolved_parents[reply_id] = (str(parent.get("id") or ""),
                                              _truncate_utf16(str(parent.get("text") or "") +
                                                              ("\nExpanded URL: " + expanded[0] if expanded else ""),
                                                              3000), path.name)
            continue
        stages: list[tuple[str, list[dict[str, Any]], set[str] | None]] = []
        for query in document.get("queries", []):
            if query.get("role") == "control":
                continue
            accepted = {str(decision.get("post_id")) for decision in query.get("decisions") or []
                        if isinstance(decision, dict) and "intent" in decision}
            stages.append((str(query.get("name") or "shopping"), query.get("pages") or [], accepted))
        for page in document.get("pages", []):
            if page.get("name") == "control":
                continue
            stages.append((str(page.get("name") or "shopping"), [page], None))
        for stage, pages, accepted in stages:
            for page in pages:
                for post in (page.get("response") or {}).get("tweets") or []:
                    if not isinstance(post, dict):
                        continue
                    post_id = str(post.get("id") or post.get("id_str") or "")
                    author = post.get("author") if isinstance(post.get("author"), dict) else {}
                    handle = str(author.get("userName") or author.get("username") or "")
                    if (not post_id.isdigit() or (accepted is not None and post_id not in accepted)
                            or not re.fullmatch(r"[A-Za-z0-9_]{1,50}", handle)
                            or post_id in rows):
                        continue
                    text = _truncate_utf16(str(post.get("text") or ""), 3000)
                    posted_at = _iso_datetime(post.get("createdAt") or post.get("created_at"))
                    try:
                        if not datetime.fromisoformat(posted_at).tzinfo:
                            posted_at = None
                    except ValueError:
                        posted_at = None
                    intent = assess_purchase_intent(text)
                    parent_id = str(post.get("inReplyToId") or "") or None
                    is_reply = bool(parent_id or post.get("isReply"))
                    rows[post_id] = {
                        "postId": post_id, "authorId": _author_id(post),
                        "handle": handle, "postUrl": f"https://x.com/{handle}/status/{post_id}",
                        "postText": text, "postedAt": posted_at,
                        "photoUrls": extract_post_photo_urls(post),
                        "sourceArchive": path.name, "sourceStage": stage,
                        "classifierVersion": intent["version"],
                        "classifierTier": intent["tier"],
                        "exclusionReasons": intent["exclusion_reasons"],
                        "intent": intent,
                        "bodyTopicMatch": bool(PET_BODY.search(text) and PRODUCT_BODY.search(text)),
                        "isReply": is_reply, "parentPostId": parent_id,
                        "parentStatus": "unresolved" if is_reply else "not_applicable",
                        "parentEvidence": None, "parentSourceArchive": None,
                    }
    for post_id, (parent_id, parent_text, archive_name) in resolved_parents.items():
        if post_id in rows and parent_id == rows[post_id]["parentPostId"]:
            rows[post_id]["parentStatus"] = "resolved_product_mismatch"
            rows[post_id]["parentEvidence"] = parent_text
            rows[post_id]["parentSourceArchive"] = archive_name
    return list(rows.values())


async def _credits(client: httpx.AsyncClient, settings: Settings) -> dict[str, int]:
    response = await client.get(
        f"{settings.twitterapi_base_url}{CREDITS_PATH}",
        headers={"X-API-Key": settings.twitterapi_api_key},
    )
    response.raise_for_status()
    payload = response.json()
    if (not isinstance(payload, dict)
            or str(payload.get("status") or "").lower() == "error"
            or not any(key in payload for key in ("recharge_credits", "total_bonus_credits"))):
        raise RuntimeError("TwitterAPI returned an invalid credits response")
    try:
        return {key: int(payload.get(key) or 0)
                for key in ("recharge_credits", "total_bonus_credits")}
    except (TypeError, ValueError) as error:
        raise RuntimeError("TwitterAPI returned invalid credit amounts") from error


def _author_id(post: dict[str, Any]) -> str:
    author = post.get("author") if isinstance(post.get("author"), dict) else {}
    return str(author.get("id") or author.get("id_str") or author.get("userName") or "")


async def run_recall_probe(
    client: httpx.AsyncClient, settings: Settings, *, archive_dir: Path = TWITTERAPI_ARCHIVE_DIR,
    lookback_days: int = 3, max_pages: int = 8, target_new_posts: int = 20,
    min_balance_credits: int = 3000, max_observed_spend: int = 2500,
    diagnose_control: bool = False, now: datetime | None = None,
) -> dict[str, Any]:
    if not settings.twitterapi_api_key:
        raise RuntimeError("TWITTERAPI_API_KEY is missing")
    if not (1 <= lookback_days <= 7 and 1 <= max_pages <= 8
            and 1 <= target_new_posts <= 100 and min_balance_credits >= 3000
            and 1 <= max_observed_spend <= 2500):
        raise ValueError("Invalid recall probe bounds")
    started = now or datetime.now(timezone.utc)
    if started.tzinfo is None:
        raise ValueError("Probe time must have a timezone")
    started = started.astimezone(timezone.utc)
    since = int((started - timedelta(days=lookback_days)).timestamp())
    until = int(started.timestamp())
    baseline_posts, baseline_authors, baseline_archives = historical_ids(archive_dir)
    run_id = f"purchase-recall-{started:%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}"
    archive_path = archive_dir / f"{run_id}.json"
    document: dict[str, Any] = {
        "archive_version": 1, "kind": "query_only_purchase_recall", "archive_id": run_id,
        "started_at": started.isoformat(), "status": "collecting",
        "baseline_archives": baseline_archives, "baseline_post_ids": len(baseline_posts),
        "baseline_authors": len(baseline_authors),
        "configuration": {"lookbackDays": lookback_days, "maxPages": max_pages,
                          "targetNewShoppingPosts": target_new_posts,
                          "minBalanceCredits": min_balance_credits,
                          "maxObservedSpend": max_observed_spend,
                          "searchProduct": "Latest", "aboutEnrichment": False,
                          "cloudImport": False, "photoVerification": False,
                          "diagnoseControl": diagnose_control},
        "queries": [],
    }
    _save(archive_path, document)
    try:
        before = await _credits(client, settings)
    except Exception as error:
        document["status"] = "failed_credit_check"
        document["error_type"] = type(error).__name__
        _save(archive_path, document)
        raise RecallProbeError(archive_path, error) from error
    current = before
    document["credits_before"] = before
    _save(archive_path, document)
    if sum(before.values()) < min_balance_credits:
        document["status"] = "stopped_low_balance"
        _save(archive_path, document)
        raise RuntimeError(f"Fewer than {min_balance_credits} credits remain; no paid search started")

    all_new_posts: set[str] = set()
    valid_new_posts: set[str] = set()
    shopping_new_posts: set[str] = set()
    shopping_body_related_new_posts: set[str] = set()
    shopping_new_authors: set[str] = set()
    shopping_dates: list[str] = []
    tiers = (("control", "dog lang:en"), *QUERY_TIERS) if diagnose_control else QUERY_TIERS
    pages_used = 0
    text_tiers: Counter[str] = Counter()
    rejection_reasons: Counter[str] = Counter()

    try:
        for tier_name, expression in tiers:
            if pages_used >= max_pages:
                break
            # A validated broad page does not end the run before testing one
            # independent buyer-language hypothesis.
            if len(shopping_new_posts) >= target_new_posts and tier_name not in {
                    "control", "shopping_pet_product", "buyer_recommend_pillow"}:
                break
            query = f"{expression} since_time:{since} until_time:{until}"
            entry: dict[str, Any] = {"name": tier_name,
                                     "role": "control" if tier_name == "control" else "shopping",
                                     "query": query, "pages": [], "decisions": [],
                                     "counts": {"raw_rows": 0, "new_post_ids": 0,
                                                "window_valid_new_posts": 0,
                                                "out_of_window_or_invalid": 0,
                                                "body_pet_product_rows": 0}}
            document["queries"].append(entry)
            _save(archive_path, document)
            cursor = ""
            tier_pages = 0
            while pages_used < max_pages and (tier_name == "control"
                                               or tier_name.startswith("buyer_") or tier_pages < 3):
                if sum(current.values()) < min_balance_credits:
                    document["status"] = "stopped_low_balance"
                    break
                if sum(before.values()) - sum(current.values()) >= max_observed_spend:
                    document["status"] = "stopped_spend_cap"
                    break
                params = {"query": query, "queryType": "Latest", "cursor": cursor}
                requested_at = datetime.now(timezone.utc).isoformat()
                response = await client.get(
                    f"{settings.twitterapi_base_url}{SEARCH_PATH}",
                    headers={"X-API-Key": settings.twitterapi_api_key}, params=params,
                )
                try:
                    payload = response.json()
                except ValueError:
                    payload = {"invalid_json": True}
                page = {"cursor": cursor, "requested_at": requested_at,
                        "received_at": datetime.now(timezone.utc).isoformat(),
                        "request_params": params, "http_status": response.status_code,
                        "business_status": payload.get("status") if isinstance(payload, dict) else None,
                        "response": payload}
                entry["pages"].append(page)
                pages_used += 1
                tier_pages += 1
                _save(archive_path, document)  # Archive the raw page before any filtering.
                if (response.status_code in {401, 402, 403, 429}
                        or response.status_code >= 500
                        or not 200 <= response.status_code < 300
                        or not isinstance(payload, dict)
                        or str(payload.get("status") or "").lower() == "error"):
                    document["status"] = "stopped_provider_error"
                    break
                posts = payload.get("tweets")
                if not isinstance(posts, list):
                    document["status"] = "stopped_invalid_payload"
                    break
                entry["counts"]["raw_rows"] += len(posts)
                page_valid_new = 0
                for post in posts:
                    if not isinstance(post, dict):
                        continue
                    raw_text = str(post.get("text") or "")
                    body_related = bool(PET_BODY.search(raw_text) and PRODUCT_BODY.search(raw_text))
                    if tier_name != "control" and body_related:
                        entry["counts"]["body_pet_product_rows"] += 1
                    post_id = str(post.get("id") or post.get("id_str") or "")
                    if not post_id or post_id in baseline_posts or post_id in all_new_posts:
                        continue
                    all_new_posts.add(post_id)
                    entry["counts"]["new_post_ids"] += 1
                    posted_at = _iso_datetime(post.get("createdAt") or post.get("created_at"))
                    try:
                        parsed = datetime.fromisoformat(posted_at)
                        posted_seconds = int(parsed.timestamp()) if parsed.tzinfo else None
                    except ValueError:
                        posted_seconds = None
                    if posted_seconds is None or not since <= posted_seconds <= until:
                        entry["counts"]["out_of_window_or_invalid"] += 1
                        entry["decisions"].append({"post_id": post_id,
                                                   "reason": "out_of_window_or_invalid_date",
                                                   "posted_at": posted_at})
                        continue
                    valid_new_posts.add(post_id)
                    page_valid_new += 1
                    entry["counts"]["window_valid_new_posts"] += 1
                    if tier_name == "control":
                        continue
                    shopping_new_posts.add(post_id)
                    if body_related:
                        shopping_body_related_new_posts.add(post_id)
                    author_id = _author_id(post)
                    if author_id and author_id not in baseline_authors:
                        shopping_new_authors.add(author_id)
                    shopping_dates.append(posted_at)
                    intent = assess_purchase_intent(raw_text)
                    text_tiers[intent["tier"]] += 1
                    rejection_reasons.update(intent["exclusion_reasons"])
                    entry["decisions"].append({
                        "post_id": post_id, "author_id": author_id,
                        "posted_at": posted_at, "intent": intent,
                        "in_reply_to_id": str(post.get("inReplyToId") or "") or None,
                        "parent_status": "unresolved" if (post.get("isReply") or post.get("inReplyToId"))
                                         else "not_applicable",
                        "parent_context_needed": needs_reply_parent_context(raw_text),
                    })
                _save(archive_path, document)
                current = await _credits(client, settings)
                document["credits_after_page"] = current
                _save(archive_path, document)
                if (tier_name == "control" or tier_name.startswith("buyer_")
                        or len(shopping_new_posts) >= target_new_posts):
                    break
                if page_valid_new == 0:
                    break
                if tier_name == "shopping_pet_product" and max_pages - pages_used <= 1:
                    break  # Reserve a page for the independent buyer query.
                next_cursor = str(payload.get("next_cursor") or "")
                if not payload.get("has_next_page") or not next_cursor or next_cursor == cursor:
                    break
                cursor = next_cursor
            if document["status"] != "collecting":
                break
        if document["status"] == "collecting":
            document["status"] = "completed"
    except Exception as error:
        document["status"] = "failed"
        document["error_type"] = type(error).__name__
        raise RecallProbeError(archive_path, error) from error
    finally:
        document["completed_at"] = datetime.now(timezone.utc).isoformat()
        document["credits_after"] = current
        document["observed_credits_used"] = sum(before.values()) - sum(current.values())
        document["summary"] = {
            "archive_id": run_id, "archive_path": str(archive_path), "status": document["status"],
            "search_pages": pages_used, "control_new_posts": len(valid_new_posts - shopping_new_posts),
            "raw_new_post_ids_including_invalid_dates": len(all_new_posts),
            "shopping_query_new_posts_vs_baseline": len(shopping_new_posts),
            "shopping_body_pet_product_new_posts": len(shopping_body_related_new_posts),
            "shopping_text_demand_new_posts": sum(count for tier, count in text_tiers.items()
                                                   if tier != "excluded"),
            "shopping_new_authors_vs_baseline": len(shopping_new_authors),
            "shopping_latest_post_at": max(shopping_dates) if shopping_dates else None,
            "shopping_text_tiers": dict(text_tiers),
            "shopping_rejection_reasons": dict(rejection_reasons),
            "stages": [{"name": query["name"], "role": query["role"],
                        **query["counts"]} for query in document["queries"]],
            "strict_qualified": 0,
            "scope": "raw_query_only_no_photo_or_us_verification_no_cloud_import",
            "credits_before": before, "credits_after": current,
            "observed_credits_used": document["observed_credits_used"],
            "credit_settlement_pending": current == before,
        }
        _save(archive_path, document)
    return document["summary"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute-paid", action="store_true", help="Actually call the paid search API")
    parser.add_argument("--lookback-days", type=int, default=3)
    parser.add_argument("--max-pages", type=int, default=8)
    parser.add_argument("--target-new-posts", type=int, default=20)
    parser.add_argument("--diagnose-control", action="store_true", help="Add one generic dog source-health page")
    args = parser.parse_args()
    if not args.execute_paid:
        parser.error("No API calls made. Pass --execute-paid to run the paid probe.")

    async def main() -> None:
        async with httpx.AsyncClient(timeout=120) as client:
            summary = await run_recall_probe(
                client, Settings(), lookback_days=args.lookback_days,
                max_pages=args.max_pages, target_new_posts=args.target_new_posts,
                diagnose_control=args.diagnose_control,
            )
        print(json.dumps(summary, ensure_ascii=False, indent=2))

    asyncio.run(main())
