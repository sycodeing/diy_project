import asyncio
import json

import httpx

from lead_studio.config import Settings
from lead_studio.demand_photo import attach_same_account_photo, record_verified_photo_source
from lead_studio.discovery import candidate_from_tweet
from lead_studio.twitterapi import collect_twitterapi_search, twitterapi_item_to_tweet


def _demand(photo=False):
    return candidate_from_tweet({
        "id": "100", "rawContent": "Where can I order a custom pillow of my dog?",
        "media": {"photos": [{"url": "https://img.example/original.jpg"}] if photo else []},
        "author": {"id": "account-1", "username": "dogowner", "location": "Austin, TX"},
    }, "demand_custom", us_required=True, us_min_confidence=70)


def _item(post_id, author_id="account-1", text="My dog in the garden", photo=True):
    return {
        "id": post_id, "text": text, "createdAt": "2026-11-15T12:00:00Z",
        "author": {"id": author_id, "userName": "dogowner", "location": "Austin, TX"},
        "media": {"photos": [{"url": f"https://img.example/{post_id}.jpg"}]} if photo else {},
    }


def test_text_only_demand_is_retained_but_legacy_still_requires_a_photo():
    assert _demand()["media_url"] == ""
    assert twitterapi_item_to_tweet(_item("101", photo=False), search_query="demand", allow_no_photo=True)
    assert twitterapi_item_to_tweet(_item("101", photo=False), search_query="legacy") is None


def test_collector_retains_a_text_only_demand_post_before_photo_join(tmp_path):
    item = _item("100", text="Where can I order a custom pillow of my dog?", photo=False)
    def handler(request):
        assert "filter:images" not in request.url.params["query"]
        return httpx.Response(200, json={"tweets": [item], "has_next_page": False})

    async def run():
        settings = Settings(twitterapi_api_key="test", twitterapi_base_url="https://api.invalid",
                            twitterapi_about_enrichment_enabled=False)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await collect_twitterapi_search(client, settings,
                {"segments": ["demand_custom"], "resultLimit": 1, "lookbackDays": 3,
                 "usRequired": True, "usMinConfidence": 70},
                state_path=tmp_path / "state.json", archive_dir=tmp_path / "runs")

    raw, candidates, metrics = asyncio.run(run())
    assert len(raw) == len(candidates) == 1
    assert candidates[0]["post_id"] == "100"
    assert candidates[0]["media_url"] == ""
    assert metrics["photo_posts"] == 0
    assert len(list((tmp_path / "runs").glob("*.json"))) == 1


def test_account_photo_join_archives_response_and_rejects_other_accounts(tmp_path):
    calls = []

    def handler(request):
        calls.append(request)
        quoted = {**_item("104"), "isQuote": True}
        return httpx.Response(200, json={"tweets": [
            _item("101", author_id="wrong-account"),
            _item("102", text="Shop now! My dog pillow"),
            quoted,
            _item("103", text="My dog on our couch"),
        ], "has_next_page": False})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await attach_same_account_photo(_demand(), client,
                Settings(twitterapi_api_key="test", twitterapi_base_url="https://api.invalid"),
                archive_id="job-1", archive_dir=tmp_path)

    joined, sources = asyncio.run(run())
    assert len(calls) == 1
    assert "from:dogowner filter:images" in calls[0].url.params["query"]
    assert joined["media_urls"] == ["https://img.example/103.jpg"]
    assert sources[joined["media_url"]]["post_id"] == "103"
    archive = json.loads(next(tmp_path.glob("*.json")).read_text(encoding="utf-8"))
    assert len(archive["response"]["tweets"]) == 4
    assert archive["demand_post_id"] == "100"
    assert record_verified_photo_source(joined, sources) is None
    evidence = json.loads(joined["targeting_json"])
    evidence["image_verification"] = {"result": "verified", "media_url": joined["media_url"]}
    verified = record_verified_photo_source({**joined, "targeting_json": json.dumps(evidence)}, sources)
    assert json.loads(verified["targeting_json"])["photo_source"]["relationship"] == "same_account"
    assert verified["post_id"] == "100"  # reply target remains the demand post


def test_no_verified_identity_never_triggers_an_account_search(tmp_path):
    candidate = {**_demand(), "author_id": ""}

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: None)) as client:
            return await attach_same_account_photo(candidate, client, Settings(), archive_id="job", archive_dir=tmp_path)

    assert asyncio.run(run()) == (None, {})
    assert not list(tmp_path.iterdir())


def test_same_post_photo_needs_no_second_provider_request(tmp_path):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: None)) as client:
            return await attach_same_account_photo(_demand(photo=True), client, Settings(), archive_id="job", archive_dir=tmp_path)

    joined, sources = asyncio.run(run())
    assert sources[joined["media_url"]]["post_url"] == joined["post_url"]
    assert not list(tmp_path.iterdir())
