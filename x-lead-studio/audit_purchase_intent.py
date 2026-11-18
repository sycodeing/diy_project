"""Replay explicit TwitterAPI archives offline; no API, database or watermark writes."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timedelta
import json
from pathlib import Path
import re

from lead_studio.purchase_intent import VERSION, assess_purchase_intent, assess_reply_with_parent
from lead_studio.twitterapi import _iso_datetime, twitterapi_item_to_tweet


def _post_time(item: dict) -> int | None:
    normalized = _iso_datetime(item.get("createdAt") or item.get("created_at"))
    if not normalized:
        return None
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    return int(parsed.timestamp()) if parsed.tzinfo else None


def _window(archive: dict, query: dict) -> tuple[int, int] | None:
    expression = str(query.get("query") or "")
    since = re.search(r"\bsince_time:(\d+)\b", expression)
    until = re.search(r"\buntil_time:(\d+)\b", expression)
    if since and until:
        return int(since.group(1)), int(until.group(1))
    try:
        started = datetime.fromisoformat(str(archive["started_at"]).replace("Z", "+00:00"))
        days = int(archive.get("configuration", {}).get("lookbackDays", 30))
    except (KeyError, TypeError, ValueError):
        return None
    if not started.tzinfo:
        return None
    return int((started - timedelta(days=days)).timestamp()), int(started.timestamp())


def audit(paths: list[Path]) -> dict:
    posts: dict[str, tuple[dict, dict | None, str]] = {}
    filter_reasons = Counter()
    for path in paths:
        archive = json.loads(path.read_text(encoding="utf-8"))
        for query in archive.get("queries", []):
            window = _window(archive, query)
            parents: dict[str, dict] = {}
            for page in query.get("pages", []):
                for item in page.get("response", {}).get("tweets", []):
                    if isinstance(item, dict) and item.get("id"):
                        parents[str(item["id"])] = item
            for entry in query.get("parent_contexts", []):
                for item in entry.get("response", {}).get("tweets", []):
                    if isinstance(item, dict) and item.get("id"):
                        parents[str(item["id"])] = item
            for source in (*query.get("pages", []), *query.get("discussion_replies", [])):
                for item in source.get("response", {}).get("tweets", []):
                    if not isinstance(item, dict):
                        continue
                    post_id = str(item.get("id") or item.get("id_str") or "")
                    if not post_id or post_id in posts:
                        continue
                    timestamp = _post_time(item)
                    if timestamp is None:
                        filter_reasons["post_time_missing_or_invalid"] += 1
                        continue
                    if window is None or not window[0] <= timestamp <= window[1]:
                        filter_reasons["post_outside_archive_window"] += 1
                        continue
                    parent_id = str(item.get("inReplyToId") or source.get("parent_id") or "")
                    posts[post_id] = (item, parents.get(parent_id), path.name)

    tiers = Counter()
    reasons = Counter(filter_reasons)
    passed: list[dict] = []
    for post_id, (item, parent, archive_name) in posts.items():
        tweet = twitterapi_item_to_tweet(item, search_query="offline-audit", allow_no_photo=True, allow_reply=True)
        if not tweet:
            reasons["unusable_post"] += 1
            continue
        text = tweet["rawContent"]
        result = (assess_reply_with_parent(text, str(parent.get("text") or ""), str(parent.get("id") or ""))
                  if parent else assess_purchase_intent(text))
        tiers[result["tier"]] += 1
        reasons.update(result["exclusion_reasons"])
        if result["tier"] != "excluded":
            author = tweet["author"]
            passed.append({
                "post_id": post_id,
                "author_id": author.get("id"),
                "author_handle": author.get("username"),
                "posted_at": tweet["date"],
                "source_archive": archive_name,
                "post_text": text,
                "has_original_photo": bool(tweet["media"]["photos"]),
                **result,
            })
    by_author: dict[str, dict] = {}
    for row in sorted(passed, key=lambda value: (value["score"], value["posted_at"] or ""), reverse=True):
        author_key = str(row["author_id"] or row["author_handle"] or row["post_id"]).casefold()
        by_author.setdefault(author_key, row)
    review = list(by_author.values())
    return {
        "version": VERSION, "archives": len(paths), "unique_posts": len(posts),
        "unique_posts_in_window": len(posts),
        "text_passed_posts": len(passed), "text_review_authors": len(review),
        "text_review_without_original_photo": sum(not row["has_original_photo"] for row in review),
        "strict_qualified": 0,
        "tiers": dict(tiers), "exclusion_reasons": dict(reasons), "matched": review,
        "note": "Offline text review only; photo, ownership, US, human review and hosted lead gates were not verified.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archives", nargs="+", type=Path)
    args = parser.parse_args()
    print(json.dumps(audit(args.archives), ensure_ascii=False, indent=2))
