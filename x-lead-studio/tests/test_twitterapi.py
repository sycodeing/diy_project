from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

from lead_studio.config import Settings
from lead_studio.twitterapi import (
    TwitterApiCreditsExhausted,
    build_query_plan,
    collect_twitterapi_search,
    twitterapi_item_to_tweet,
)
from lead_studio.x_lead_worker import _provider_is_configured, _selected_provider


CONFIG = {
    "segments": ["new_adoption", "pet_birthday"],
    "resultLimit": 40,
    "lookbackDays": 30,
    "searchProduct": "Top",
    "usRequired": True,
    "usMinConfidence": 70,
}


def test_query_plan_uses_latest_incremental_windows_and_ninety_percent_us() -> None:
    now = datetime(2026, 10, 27, 7, 0, tzinfo=timezone.utc)
    state = {"new_adoption:us": int(datetime(2026, 10, 26, tzinfo=timezone.utc).timestamp())}

    plans = build_query_plan(dict(CONFIG), state=state, us_share=90, now=now)

    assert [(plan.segment.key, plan.mode, plan.limit) for plan in plans] == [
        ("new_adoption", "us", 18),
        ("new_adoption", "broad", 2),
        ("pet_birthday", "us", 18),
        ("pet_birthday", "broad", 2),
    ]
    assert plans[0].since_time == state["new_adoption:us"]
    assert "place_country:US" in plans[0].query
    assert "since_time:" in plans[0].query
    assert "until_time:" in plans[0].query
    assert "place_country:US" not in plans[1].query


def test_query_plan_uses_broad_search_only_when_geo_queries_are_disabled() -> None:
    now = datetime(2026, 10, 31, 7, 0, tzinfo=timezone.utc)

    plans = build_query_plan(dict(CONFIG), state={}, include_geo=False, now=now)

    assert [(plan.segment.key, plan.mode, plan.limit) for plan in plans] == [
        ("new_adoption", "broad", 20),
        ("pet_birthday", "broad", 20),
    ]
    assert all("place_country:US" not in plan.query for plan in plans)


def test_apify_token_alone_cannot_reactivate_dormant_provider() -> None:
    twitterapi = Settings(
        x_lead_provider="twitterapi",
        twitterapi_api_key="twitter-key",
        apify_api_token="retained-apify-token",
        apify_enabled=False,
    )
    disabled_apify = Settings(
        x_lead_provider="apify",
        apify_api_token="retained-apify-token",
        apify_enabled=False,
    )

    assert _selected_provider(twitterapi) == "twitterapi"
    assert _provider_is_configured(twitterapi, "twitterapi") is True
    assert _selected_provider(disabled_apify) == "apify-disabled"
    assert _provider_is_configured(disabled_apify, "apify-disabled") is False


def test_broad_query_absorbs_unused_us_capacity(tmp_path: Path) -> None:
    broad_posts = []
    for index in range(20):
        item = _tweet()
        item["id"] = str(2000 + index)
        item["extendedEntities"] = {
            "media": [{"type": "photo", "media_url_https": f"https://img.example/{index}.jpg"}],
        }
        broad_posts.append(item)

    def handler(request: httpx.Request) -> httpx.Response:
        query = request.url.params["query"]
        if "place_country:US" in query:
            us_post = broad_posts[0]
            return httpx.Response(200, json={"tweets": [us_post], "has_next_page": False, "next_cursor": ""})
        return httpx.Response(200, json={"tweets": broad_posts[1:], "has_next_page": False, "next_cursor": ""})

    async def run() -> tuple[list[dict[str, object]], list[dict[str, object]], dict[str, object]]:
        settings = Settings(
            twitterapi_api_key="secret",
            twitterapi_base_url="https://api.twitterapi.io",
            twitterapi_geo_query_enabled=True,
            twitterapi_about_enrichment_enabled=False,
        )
        config = {**CONFIG, "segments": ["new_adoption"], "resultLimit": 10}
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await collect_twitterapi_search(client, settings, config, state_path=tmp_path / "state.json")

    items, candidates, metrics = asyncio.run(run())

    assert len(items) == 10
    assert len(candidates) == 10
    assert metrics["reallocated_broad_limit"] == 8


def test_normalizer_accepts_photo_and_rejects_video_only() -> None:
    item = _tweet()
    item["extendedEntities"] = {
        "media": [
            {"type": "video", "media_url_https": "https://img.example/video.jpg"},
            {"type": "photo", "media_url_https": "https://img.example/pet.jpg"},
        ],
    }

    normalized = twitterapi_item_to_tweet(item, search_query="pets place_country:US")

    assert normalized is not None
    assert normalized["media"]["photos"] == [{"url": "https://img.example/pet.jpg"}]
    assert normalized["author"]["username"] == "petperson"
    assert normalized["date"] == "2026-10-26T18:00:00+00:00"

    item["extendedEntities"]["media"] = [
        {"type": "video", "media_url_https": "https://img.example/video.jpg"},
    ]
    assert twitterapi_item_to_tweet(item, search_query="pets") is None


def test_normalizer_prefers_direct_media_url_over_tco_post_link() -> None:
    item = _tweet()
    item["media"] = [
        {
            "type": "photo",
            "url": "https://t.co/not-an-image",
            "media_url_https": "https://pbs.twimg.com/media/pet.jpg",
        },
    ]

    normalized = twitterapi_item_to_tweet(item, search_query="pets")

    assert normalized is not None
    assert normalized["media"]["photos"] == [{"url": "https://pbs.twimg.com/media/pet.jpg"}]


def test_normalizer_rejects_tco_when_no_direct_media_url_exists() -> None:
    item = _tweet()
    item["media"] = [{"type": "photo", "url": "https://t.co/not-an-image"}]

    assert twitterapi_item_to_tweet(item, search_query="pets") is None


def test_collection_paginates_deduplicates_and_persists_watermarks(tmp_path: Path) -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        query = request.url.params["query"]
        cursor = request.url.params.get("cursor", "")
        tweet = _tweet()
        tweet["extendedEntities"] = {
            "media": [{"type": "photo", "media_url_https": "https://img.example/pet.jpg"}],
        }
        if "place_country:US" in query and not cursor:
            return httpx.Response(200, json={"tweets": [tweet], "has_next_page": True, "next_cursor": "next"})
        if "place_country:US" in query and cursor == "next":
            return httpx.Response(200, json={"tweets": [tweet], "has_next_page": False, "next_cursor": ""})
        return httpx.Response(200, json={"tweets": [], "has_next_page": False, "next_cursor": ""})

    settings = Settings(
        twitterapi_api_key="secret",
        twitterapi_base_url="https://api.twitterapi.io",
        twitterapi_us_query_share=90,
        twitterapi_geo_query_enabled=True,
        twitterapi_about_enrichment_enabled=False,
    )
    config = {**CONFIG, "segments": ["new_adoption"], "resultLimit": 3}
    state_path = tmp_path / "watermarks.json"
    async def run() -> tuple[list[dict[str, object]], list[dict[str, object]], dict[str, object]]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await collect_twitterapi_search(client, settings, config, state_path=state_path)

    items, candidates, metrics = asyncio.run(run())

    assert len(items) == 1
    assert len(candidates) == 1
    assert candidates[0]["status"] == "new"
    assert metrics["duplicate_posts"] == 1
    assert metrics["query_product"] == "Latest"
    assert all(request.headers["X-API-Key"] == "secret" for request in calls)
    assert all(request.url.params["queryType"] == "Latest" for request in calls)
    persisted = json.loads(state_path.read_text(encoding="utf-8"))
    assert "new_adoption:us" in persisted


def test_collection_archives_full_response_before_truncation_and_filtering(tmp_path: Path) -> None:
    returned = []
    for index in range(3):
        item = _tweet()
        item["id"] = str(3000 + index)
        if index == 0:
            item["extendedEntities"] = {
                "media": [{"type": "photo", "media_url_https": "https://img.example/us.jpg"}],
            }
        elif index == 2:
            item["author"] = {**item["author"], "location": "Paris, France"}
        returned.append(item)

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "tweets": returned,
                "has_next_page": False,
                "next_cursor": "",
                "provider_metadata": {"result_count": 3},
            },
        )

    settings = Settings(
        twitterapi_api_key="must-not-be-archived",
        twitterapi_base_url="https://api.twitterapi.io",
        twitterapi_us_query_share=100,
        twitterapi_geo_query_enabled=True,
        twitterapi_about_enrichment_enabled=False,
    )
    archive_dir = tmp_path / "archives"

    async def run() -> tuple[list[dict[str, object]], list[dict[str, object]], dict[str, object]]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await collect_twitterapi_search(
                client,
                settings,
                {**CONFIG, "segments": ["new_adoption"], "resultLimit": 2},
                state_path=tmp_path / "watermarks.json",
                archive_id="retention-test",
                archive_dir=archive_dir,
            )

    items, candidates, metrics = asyncio.run(run())

    archive_text = (archive_dir / "retention-test.json").read_text(encoding="utf-8")
    archive = json.loads(archive_text)
    archived_response = archive["queries"][0]["pages"][0]["response"]
    assert len(items) == 2
    assert len(candidates) == 1
    assert metrics["received_posts"] == 2
    assert metrics["archived_posts"] == 3
    assert metrics["archive_id"] == "retention-test"
    assert archive["status"] == "completed"
    assert len(archived_response["tweets"]) == 3
    assert archived_response["provider_metadata"] == {"result_count": 3}
    assert "must-not-be-archived" not in archive_text


def test_collection_enriches_missing_locations_once_per_author_and_reuses_cache(tmp_path: Path) -> None:
    about_calls = 0
    posts = []
    for index in range(2):
        item = _tweet()
        item["id"] = str(4000 + index)
        item["author"] = {**item["author"], "location": ""}
        item["extendedEntities"] = {
            "media": [{"type": "photo", "media_url_https": f"https://img.example/{index}.jpg"}],
        }
        posts.append(item)

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal about_calls
        if request.url.path == "/twitter/user_about":
            about_calls += 1
            return httpx.Response(
                200,
                json={
                    "status": "success",
                    "data": {
                        "userName": "petperson",
                        "about_profile": {
                            "account_based_in": "United States",
                            "location_accurate": True,
                        },
                    },
                },
            )
        return httpx.Response(200, json={"tweets": posts, "has_next_page": False, "next_cursor": ""})

    settings = Settings(
        twitterapi_api_key="secret",
        twitterapi_base_url="https://api.twitterapi.io",
        twitterapi_geo_query_enabled=False,
        twitterapi_about_enrichment_enabled=True,
        twitterapi_about_cache_days=30,
    )
    cache_path = tmp_path / "about-cache.json"

    async def run(state_name: str) -> tuple[list[dict[str, object]], list[dict[str, object]], dict[str, object]]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await collect_twitterapi_search(
                client,
                settings,
                {**CONFIG, "segments": ["new_adoption"], "resultLimit": 2},
                state_path=tmp_path / state_name,
                about_cache_path=cache_path,
            )

    _, first_candidates, first_metrics = asyncio.run(run("first-watermarks.json"))
    _, second_candidates, second_metrics = asyncio.run(run("second-watermarks.json"))

    assert about_calls == 1
    assert len(first_candidates) == 2
    assert {candidate["us_confidence"] for candidate in first_candidates} == {88}
    assert {candidate["us_evidence"] for candidate in first_candidates} == {"account_based_in:US"}
    assert {candidate["status"] for candidate in first_candidates} == {"new"}
    assert first_metrics["about_candidates"] == 1
    assert first_metrics["about_api_calls"] == 1
    assert first_metrics["about_us_accounts"] == 1
    assert second_metrics["about_cache_hits"] == 1
    assert second_metrics["about_api_calls"] == 0
    assert {candidate["status"] for candidate in second_candidates} == {"new"}
    cache_text = cache_path.read_text(encoding="utf-8")
    assert "secret" not in cache_text
    assert "United States" in cache_text


def test_collection_rejects_confirmed_non_us_about_location(tmp_path: Path) -> None:
    item = _tweet()
    item["author"] = {**item["author"], "location": ""}
    item["extendedEntities"] = {
        "media": [{"type": "photo", "media_url_https": "https://img.example/pet.jpg"}],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/twitter/user_about":
            return httpx.Response(
                200,
                json={
                    "status": "success",
                    "data": {
                        "about_profile": {
                            "account_based_in": "France",
                            "location_accurate": True,
                        },
                    },
                },
            )
        return httpx.Response(200, json={"tweets": [item], "has_next_page": False, "next_cursor": ""})

    async def run() -> tuple[list[dict[str, object]], list[dict[str, object]], dict[str, object]]:
        settings = Settings(twitterapi_api_key="secret", twitterapi_base_url="https://api.twitterapi.io")
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await collect_twitterapi_search(
                client,
                settings,
                {**CONFIG, "segments": ["new_adoption"], "resultLimit": 1},
                state_path=tmp_path / "watermarks.json",
            )

    _, candidates, metrics = asyncio.run(run())

    assert len(candidates) == 1
    assert candidates[0]["us_confidence"] == 0
    assert candidates[0]["us_evidence"] == "account_based_in_non_us:France"
    assert candidates[0]["status"] == "rejected_targeting"
    assert metrics["about_non_us_accounts"] == 1


def test_credit_exhaustion_is_terminal(tmp_path: Path) -> None:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(402, json={"status": "error", "message": "credits"})

    settings = Settings(twitterapi_api_key="secret", twitterapi_base_url="https://api.twitterapi.io")
    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await collect_twitterapi_search(
                client,
                settings,
                {**CONFIG, "segments": ["new_adoption"], "resultLimit": 1},
                state_path=tmp_path / "watermarks.json",
            )

    with pytest.raises(TwitterApiCreditsExhausted):
        asyncio.run(run())
    assert calls == 1
    archives = list((tmp_path / "runs").glob("*.json"))
    assert len(archives) == 1
    assert json.loads(archives[0].read_text(encoding="utf-8"))["status"] == "partial"


def _tweet() -> dict[str, object]:
    return {
        "id": "1234567890",
        "text": "We just adopted our new puppy and welcome home!",
        "createdAt": "Mon Oct 26 18:00:00 +0000 2026",
        "likeCount": 15,
        "replyCount": 2,
        "retweetCount": 1,
        "viewCount": 500,
        "author": {
            "id": "42",
            "userName": "petperson",
            "description": "Dog person",
            "location": "Austin, TX",
            "followers": 300,
        },
    }
