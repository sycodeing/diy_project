"""Bounded, read-only TwitterAPI purchase-intent query probe (paid)."""

from __future__ import annotations

import argparse
import asyncio
import json
import uuid
from dataclasses import replace
from datetime import datetime, timezone

import httpx

from lead_studio.config import DATA_DIR, Settings, TWITTERAPI_ARCHIVE_DIR
from lead_studio.twitterapi import collect_twitterapi_search


async def _credits(client: httpx.AsyncClient, settings: Settings) -> dict[str, int]:
    response = await client.get(
        f"{settings.twitterapi_base_url}/oapi/my/info",
        headers={"X-API-Key": settings.twitterapi_api_key},
    )
    response.raise_for_status()
    payload = response.json()
    return {
        "recharge_credits": int(payload.get("recharge_credits") or 0),
        "total_bonus_credits": int(payload.get("total_bonus_credits") or 0),
    }


async def _probe(segment: str, revision: str, lookback_days: int, result_limit: int,
                 min_balance_credits: int) -> None:
    settings = replace(Settings(), twitterapi_about_enrichment_enabled=False,
                       twitterapi_geo_query_enabled=False)
    if not settings.twitterapi_api_key:
        raise RuntimeError("TWITTERAPI_API_KEY is missing")
    archive_id = f"purchase-intent-{segment}-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}"
    configuration = {
        "segments": [segment] if segment else ["demand_custom", "demand_gift", "demand_reply"],
        "searchProduct": "Latest",
        "resultLimit": result_limit,
        "lookbackDays": lookback_days,
        "usRequired": True,
        "usMinConfidence": 70,
        "maxPagesPerQuery": 1,
        "maxDiscussionParents": 2,
        "discoveryMode": "query_only_probe",
    }
    if revision:
        configuration["queryRevisions"] = [revision]
    # Isolated probe cursor; never alter the worker's production watermark.
    state_path = DATA_DIR / "twitterapi" / f"probe-watermarks-{archive_id}.json"
    async with httpx.AsyncClient(timeout=120) as client:
        before = await _credits(client, settings)
        if before["total_bonus_credits"] + before["recharge_credits"] < min_balance_credits:
            raise RuntimeError(f"Fewer than {min_balance_credits} credits remain; paid probe not started")
        print(json.dumps({"archive_id": archive_id, "credits_before": before,
                          "archive_path": str(TWITTERAPI_ARCHIVE_DIR / f"{archive_id}.json")}, ensure_ascii=False))
        try:
            _, candidates, metrics = await collect_twitterapi_search(
                client, settings, configuration, state_path=state_path,
                archive_id=archive_id, archive_dir=TWITTERAPI_ARCHIVE_DIR,
            )
        finally:
            after = await _credits(client, settings)
            for _ in range(4):
                if after != before:
                    break
                await asyncio.sleep(3)
                after = await _credits(client, settings)
            print(json.dumps({"credits_after": after,
                              "credits_used_observed": sum(before.values()) - sum(after.values()),
                              "credit_settlement_pending": after == before}, ensure_ascii=False))
    summary = {
        "archive_id": archive_id,
        "query_count": metrics["query_count"],
        "page_count": metrics["page_count"],
        "unique_posts": metrics["unique_posts"],
        "intent_prefilter_rejected": metrics["intent_prefilter_rejected"],
        "intent_rejection_reasons": metrics["intent_rejection_reasons"],
        "candidate_posts": metrics["candidate_posts"],
        "text_review_posts": len({str(c.get("post_id")) for c in candidates
                                   if c.get("status") in {"new", "targeting_review", "location_review"}}),
        "text_review_authors": len({str(c.get("author_hash")) for c in candidates
                                     if c.get("status") in {"new", "targeting_review", "location_review"}}),
        "strict_qualified": 0,
        "scope": "query_only_text_review_no_photo_verification_no_cloud_import",
        "pet_type_pending": metrics["pet_type_pending"],
        "reply_parent_lookups": metrics["reply_parent_lookups"],
        "reply_parent_resolved": metrics["reply_parent_resolved"],
        "discussion_parents_checked": metrics["discussion_parents_checked"],
        "discussion_replies_received": metrics["discussion_replies_received"],
        "query_slices": metrics["query_slices"],
        "candidate_statuses": {status: sum(c.get("status") == status for c in candidates)
                               for status in sorted({str(c.get("status")) for c in candidates})},
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute-paid", action="store_true", help="Actually call the paid search API")
    parser.add_argument("--segment", choices=["demand_custom", "demand_gift", "demand_reply", "demand_discussion"], help="Probe one query segment")
    parser.add_argument("--revision", default="", help="Probe only this query revision")
    parser.add_argument("--lookback-days", type=int, default=14)
    parser.add_argument("--result-limit", type=int, default=5)
    parser.add_argument("--min-balance-credits", type=int, default=3000)
    args = parser.parse_args()
    if not args.execute_paid:
        parser.error("No API calls made. Pass --execute-paid to run the paid probe.")
    if args.revision and not args.segment:
        parser.error("--revision requires --segment")
    if not 1 <= args.lookback_days <= 90 or not 1 <= args.result_limit <= 100 or args.min_balance_credits < 1:
        parser.error("Invalid probe bounds")
    asyncio.run(_probe(args.segment or "", args.revision, args.lookback_days,
                       args.result_limit, args.min_balance_credits))
