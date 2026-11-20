import asyncio
import json
from datetime import datetime, timezone

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
        "id": post_id, "text": text, "createdAt": datetime.now(timezone.utc).isoformat(),
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


def test_collector_filters_seller_before_account_lookup_and_counts_query_slice(tmp_path):
    buyer = _item("201", text="Where can I order a custom pillow of my dog?", photo=False)
    seller = _item("202", text="Shop now: custom pillow of my dog, looking for buyers", photo=False)
    seller["author"] = {**seller["author"], "id": "seller-1", "userName": "seller", "location": ""}
    calls = []

    def handler(request):
        calls.append(request.url.path)
        assert request.url.path.endswith("advanced_search")
        return httpx.Response(200, json={"tweets": [buyer, seller], "has_next_page": False})

    async def run():
        settings = Settings(twitterapi_api_key="test", twitterapi_base_url="https://api.invalid")
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await collect_twitterapi_search(client, settings,
                {"segments": ["demand_custom"], "resultLimit": 2, "lookbackDays": 3,
                 "usRequired": True, "usMinConfidence": 70},
                state_path=tmp_path / "state.json", archive_dir=tmp_path / "runs")

    _, candidates, metrics = asyncio.run(run())
    assert len(calls) == 2  # two independent custom-query variants
    assert [candidate["post_id"] for candidate in candidates] == ["201"]
    assert metrics["intent_prefilter_rejected"] == 1
    assert metrics["query_slices"][0]["intent_passed"] == 1
    assert metrics["query_slices"][0]["intent_rejected"] == 1
    assert metrics["query_slices"][0]["query_revision"] == "v7-product"


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


def test_unsuitable_original_can_fall_back_to_cached_same_account_photo(tmp_path):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"tweets": [_item("103", text="My dog on the couch")], "has_next_page": False})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            original, _ = await attach_same_account_photo(_demand(photo=True), client, Settings(),
                archive_id="job-1", archive_dir=tmp_path)
            fallback, sources = await attach_same_account_photo(original, client,
                Settings(twitterapi_api_key="test", twitterapi_base_url="https://api.invalid"),
                archive_id="job-1", archive_dir=tmp_path, force_search=True)
            second, second_sources = await attach_same_account_photo(original, client, Settings(),
                archive_id="job-2", archive_dir=tmp_path, force_search=True)
            return fallback, sources, second, second_sources

    fallback, sources, second, second_sources = asyncio.run(run())
    assert len(requests) == 1
    assert fallback["media_url"] == second["media_url"] == "https://img.example/103.jpg"
    assert sources[fallback["media_url"]]["post_id"] == second_sources[second["media_url"]]["post_id"] == "103"
    assert len(list(tmp_path.glob("*-photo-*.json"))) == 1


def test_photo_caption_can_supply_missing_ownership_but_not_wrong_pet_type(tmp_path):
    candidate = _demand()
    candidate["ownership_confidence"] = 0
    evidence = json.loads(candidate["targeting_json"])
    evidence["ownership_evidence_pending"] = True
    evidence["image_verification"] = {"result": "verified", "media_url": "https://img.example/dog.jpg"}
    candidate.update(media_url="https://img.example/dog.jpg", targeting_json=json.dumps(evidence))
    source = {"post_id": "103", "post_url": "https://x.com/dogowner/status/103",
              "author_id": "account-1", "author_handle": "dogowner", "ownership_confidence": 88,
              "pet_type": "dog"}
    confirmed = record_verified_photo_source(candidate, {candidate["media_url"]: source})
    assert confirmed["ownership_confidence"] == 88
    assert json.loads(confirmed["targeting_json"])["ownership_evidence_pending"] is False
    assert record_verified_photo_source(candidate, {candidate["media_url"]: {**source, "pet_type": "cat"}}) is None
