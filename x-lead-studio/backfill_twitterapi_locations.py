from __future__ import annotations

import argparse
import asyncio
import json
from datetime import timedelta

import httpx

from lead_studio.config import Settings, TWITTERAPI_ABOUT_CACHE_PATH, ensure_data_dirs
from lead_studio.twitterapi import (
    _about_cache_entry_is_fresh,
    _load_about_cache,
    _request_user_about,
    _save_about_cache,
)


async def fetch_locations(handles: list[str]) -> list[dict[str, object]]:
    settings = Settings()
    if not settings.twitterapi_api_key:
        raise RuntimeError("TWITTERAPI_API_KEY is required")

    ensure_data_dirs()
    cache = _load_about_cache(TWITTERAPI_ABOUT_CACHE_PATH)
    accounts = cache.setdefault("accounts", {})
    max_age = timedelta(days=settings.twitterapi_about_cache_days)
    request_lock = asyncio.Lock()

    async with httpx.AsyncClient(timeout=30) as client:
        async def fetch(handle: str) -> dict[str, object]:
            normalized = handle.strip().lstrip("@").casefold()
            cached = accounts.get(normalized)
            if isinstance(cached, dict) and _about_cache_entry_is_fresh(cached, max_age):
                entry = cached
                source = "cache"
            else:
                try:
                    async with request_lock:
                        entry = await _request_user_about(client, settings, normalized)
                        await asyncio.sleep(1.1)
                except (httpx.HTTPError, RuntimeError) as error:
                    return {
                        "handle": normalized,
                        "account_based_in": None,
                        "location_accurate": None,
                        "source": "error",
                        "error": type(error).__name__,
                    }
                accounts[normalized] = entry
                _save_about_cache(TWITTERAPI_ABOUT_CACHE_PATH, cache)
                source = "api"
            return {
                "handle": normalized,
                "account_based_in": entry.get("account_based_in") or None,
                "location_accurate": entry.get("location_accurate"),
                "source": source,
            }

        normalized_handles = sorted({
            handle.strip().lstrip("@").casefold()
            for handle in handles
            if handle.strip()
        })
        results = await asyncio.gather(*(fetch(handle) for handle in normalized_handles))

    _save_about_cache(TWITTERAPI_ABOUT_CACHE_PATH, cache)
    return sorted(results, key=lambda item: str(item["handle"]))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch TwitterAPI user_about location evidence for X handles."
    )
    parser.add_argument("handles", nargs="+", help="X handles, with or without @")
    args = parser.parse_args()
    print(json.dumps(asyncio.run(fetch_locations(args.handles)), ensure_ascii=False))


if __name__ == "__main__":
    main()
