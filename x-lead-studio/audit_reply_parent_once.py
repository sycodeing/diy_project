"""Fetch one exact reply parent for local purchase-intent review (paid, read-only)."""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime, timezone

import httpx

from lead_studio.config import Settings, TWITTERAPI_ARCHIVE_DIR


POST_ID = "2121499515727364112"


async def credits(client: httpx.AsyncClient, settings: Settings) -> dict[str, int]:
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


async def run() -> None:
    settings = Settings()
    if not settings.twitterapi_api_key:
        raise RuntimeError("TWITTERAPI_API_KEY is missing")
    archive_path = TWITTERAPI_ARCHIVE_DIR / f"reply-parent-{POST_ID}-raw.json"
    if archive_path.exists():
        raise RuntimeError(f"Archive already exists: {archive_path}")

    async with httpx.AsyncClient(timeout=60) as client:
        before = await credits(client, settings)
        if sum(before.values()) < 15:
            raise RuntimeError("Fewer than 15 credits remain; parent lookup not started")
        print(json.dumps({"credits_before": before, "parent_id": POST_ID}))

        # One exact request. An ambiguous network failure must be investigated before retrying.
        response = await client.get(
            f"{settings.twitterapi_base_url}/twitter/tweets",
            headers={"X-API-Key": settings.twitterapi_api_key},
            params={"tweet_ids": POST_ID},
        )
        response.raise_for_status()
        archive_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = archive_path.with_suffix(archive_path.suffix + ".part")
        with temporary_path.open("xb") as archive:
            archive.write(response.content)
        temporary_path.replace(archive_path)
        print(json.dumps({"raw_archive": str(archive_path), "archived_bytes": archive_path.stat().st_size}))

        after = await credits(client, settings)
        for _ in range(4):
            if after != before:
                break
            await asyncio.sleep(3)
            after = await credits(client, settings)
        print(json.dumps({
            "credits_after": after,
            "credits_used_observed": sum(before.values()) - sum(after.values()),
            "credit_settlement_pending": after == before,
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }))


async def check_balance() -> None:
    settings = Settings()
    if not settings.twitterapi_api_key:
        raise RuntimeError("TWITTERAPI_API_KEY is missing")
    async with httpx.AsyncClient(timeout=30) as client:
        print(json.dumps({"credits_now": await credits(client, settings),
                          "checked_at": datetime.now(timezone.utc).isoformat()}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--execute-paid", action="store_true")
    action.add_argument("--balance-only", action="store_true")
    args = parser.parse_args()
    asyncio.run(run() if args.execute_paid else check_balance())
