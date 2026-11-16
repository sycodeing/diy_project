import asyncio
import json
from datetime import datetime, timezone

import httpx
import pytest

from lead_studio.config import Settings
from lead_studio.discovery import candidate_from_tweet
from lead_studio.purchase_intent import assess_purchase_intent
from lead_studio.twitterapi import build_query_plan
from lead_studio import x_lead_worker as worker


@pytest.mark.parametrize("text,tier", [
    ("Where can I order a custom pillow with a photo of my dog?", "explicit_request"),
    ("Anyone recommend a portrait of my cat?", "explicit_request"),
    ("I would love a pillow with a photo of my dog", "exploratory"),
    ("My cat is adorable, happy birthday!", "excluded"),
    ("Looking for a pillow for my dog to sleep on", "excluded"),
    ("I just ordered a custom pillow of my cat", "excluded"),
    ("I don't want a portrait of my cat, anyone know why?", "excluded"),
    ("Where can I buy a portrait of my dog by Friday?", "excluded"),
    ("My dog died, looking for a portrait", "excluded"),
    ("I make custom portraits of my dog, shop now", "excluded"),
    ("Where can I buy a pillow? My dog is cute", "excluded"),
    ("If I had money I would love a portrait of my cat", "excluded"),
])
def test_text_evidence(text, tier):
    result = assess_purchase_intent(text)
    assert result["tier"] == tier
    assert result["contact_permission"] is False
    assert result["human_review_required"] is True


def test_adjacent_sentences_keep_one_buyer_request_without_merging_unrelated_pet_chat():
    intent = assess_purchase_intent("Any recommendations for a custom pillow? I'd like my cat on it.")
    assert intent["tier"] == "explicit_request"
    assert intent["scene"] == "custom"
    assert "my cat on it" in intent["evidence"][0].lower()
    assert assess_purchase_intent("Where can I buy a pillow? My dog is cute.")["tier"] == "excluded"
    assert assess_purchase_intent("Looking for a custom pillow? My cat is cute.")["tier"] == "excluded"
    assert assess_purchase_intent("Looking for a custom pillow? Shop now for my cat!")["tier"] == "excluded"


def test_request_scope_keeps_buyers_without_admitting_pet_beds_or_sellers():
    direct = assess_purchase_intent("I want a pillow with my dog on it.")
    assert (direct["tier"], direct["audience"]) == ("explicit_request", "direct_demand")
    assert assess_purchase_intent(
        "Looking for a custom pillow of my dog. I make coffee every morning."
    )["tier"] == "explicit_request"
    assert assess_purchase_intent(
        "Looking for a custom pillow of my dog. Tomorrow I'm going hiking."
    )["tier"] == "explicit_request"
    assert assess_purchase_intent("I make custom portraits of my dog, shop now")["tier"] == "excluded"
    assert assess_purchase_intent("I need a pillow for my dog to sleep on")["tier"] == "excluded"


def test_gift_for_pet_owner_is_exploration_with_original_evidence():
    result = assess_purchase_intent("Need a gift for my wife who loves her dog.")
    assert (result["scene"], result["tier"], result["audience"]) == (
        "gift", "exploratory", "gift_exploration",
    )
    assert result["evidence"] == ["Need a gift for my wife who loves her dog"]
    assert assess_purchase_intent("Looking for a gift for my dog")["tier"] == "excluded"
    assert assess_purchase_intent("Looking for dog gift ideas, shop now")["tier"] == "excluded"
    assert assess_purchase_intent("Looking for the ultimate Dog Mom Christmas gift? Order here")["tier"] == "excluded"


@pytest.mark.parametrize("text,scene", [
    ("Looking for a custom pillow of my dog", "custom"),
    ("Looking for a gift with a photo of my cat for my partner", "gift"),
    ("Any gift ideas with a photo of my dog for my wife?", "gift"),
    ("I would love a portrait of my cat for my living room", "decor"),
    ("Looking for a portrait of my dog as a gift for our living room", "gift"),
    ("My dog has a birthday next month", None),
    ("Looking for a gift for my dog", None),
    ("Looking for custom dog treats as a gift for my dog", None),
    ("I already bought a portrait of my cat as a gift", None),
    ("Looking for a custom gift of my dog in 12 days", None),
    ("Looking for a custom gift of my dog by Monday", None),
    ("I sell custom photo gifts of my dog", None),
    ("My cat died, looking for a custom photo gift", None),
])
def test_scene_evidence_is_not_the_search_segment(text, scene):
    result = assess_purchase_intent(text)
    assert result["scene"] == scene
    assert (result["tier"] == "excluded") == (scene is None)


def test_new_scene_queries_keep_legacy_path_and_bounded_raw_budget():
    plans = build_query_plan({"segments": ["demand_custom", "demand_gift", "demand_decor"],
                              "resultLimit": 90, "lookbackDays": 3}, include_geo=False,
                             now=datetime(2026, 11, 16, tzinfo=timezone.utc))
    assert len(plans) == 3
    assert sum(plan.limit for plan in plans) == 90
    assert all(len(plan.query) < 440 and "filter:images" not in plan.query for plan in plans)
    assert {plan.segment.key: plan.state_key for plan in plans} == {
        "demand_custom": "demand_custom:v5:broad",
        "demand_gift": "demand_gift:v6:broad",
        "demand_decor": "demand_decor:v5:broad",
    }
    assert all('"my dog"' not in plan.query and '"my cat"' not in plan.query for plan in plans)
    by_segment = {plan.segment.key: plan.query for plan in plans}
    assert '"looking for"' in by_segment['demand_custom']
    assert '"gift ideas"' in by_segment['demand_gift']
    assert '"would love"' in by_segment['demand_decor']
    gift = make_candidate(text="Looking for a photo gift of my cat for my wife", segment="demand_gift")
    assert gift["status"] == "targeting_review"
    assert json.loads(gift["targeting_json"])["purchase_intent"]["scene"] == "gift"


def make_candidate(text="Where can I order a custom pillow of my dog?", location="Austin, TX", segment="demand_custom", with_photo=True):
    return candidate_from_tweet({
        "id": "123", "rawContent": text,
        "media": {"photos": [{"url": "https://example.com/dog.jpg"}] if with_photo else []},
        "user": {"id": "owner-id", "username": "owner", "location": location},
    }, segment, us_required=True, us_min_confidence=70)


def test_legacy_is_unchanged_and_demand_is_review_only():
    legacy = make_candidate(segment="pet_daily_dog")
    assert "purchase_intent" not in json.loads(legacy["targeting_json"])
    demand = make_candidate()
    assert demand["status"] == "targeting_review"
    cloud = worker._cloud_candidate(demand)
    assert cloud["segment"] == "custom"  # existing DB enum, no schema expansion
    assert cloud["targetingData"]["discovery_segment"] == "demand_custom"
    assert cloud["targetingData"]["purchase_intent"]["tier"] == "explicit_request"
    assert make_candidate(location="London, United Kingdom")["status"] == "rejected_targeting"
    assert make_candidate(location="London, UK")["status"] == "location_review"
    assert make_candidate(location="")["status"] == "location_review"
    assert make_candidate(text="My dog is cute")["status"] == "rejected_targeting"
    text_only = make_candidate(with_photo=False)
    assert text_only["media_url"] == ""
    assert text_only["author_id"] == "owner-id"


def test_ownership_is_pending_only_when_all_other_demand_gates_pass():
    pending = make_candidate(text="Where can I order a custom pillow of a cat?")
    assert pending["status"] == "targeting_review"
    assert json.loads(pending["targeting_json"])["ownership_evidence_pending"] is True
    assert pending["ownership_confidence"] == 0
    assert make_candidate(text="Shop now: where can I order a custom pillow of a cat?")["status"] == "rejected_targeting"
    assert make_candidate(text="Where can I order a custom pillow of a cat?", location="United Kingdom")["status"] == "rejected_targeting"


def test_query_cursors_and_budget_are_separate():
    now = datetime(2026, 11, 13, tzinfo=timezone.utc)
    plans = build_query_plan({"segments": ["demand_custom", "demand_recommendation"],
        "resultLimit": 60, "lookbackDays": 7}, include_geo=False,
        now=now, state={"pet_daily_dog:broad": int(now.timestamp())})
    assert sum(p.limit for p in plans) == 60
    assert all(p.since_time < int(now.timestamp()) for p in plans)
    assert all(p.state_key.startswith("demand_") and len(p.query) < 440 for p in plans)
    revised = build_query_plan({"segments": ["demand_custom"], "resultLimit": 1, "lookbackDays": 3},
        state={"demand_custom:broad": int(now.timestamp()) - 100}, include_geo=False, now=now)
    assert revised[0].state_key == "demand_custom:v5:broad"
    assert revised[0].since_time == int(now.timestamp()) - 3 * 86400
    tiny = build_query_plan({"segments": ["demand_custom", "demand_decor"], "resultLimit": 1}, now=now)
    assert sum(p.limit for p in tiny) == 1


def test_completed_demand_job_filters_before_vision_and_preserves_evidence(monkeypatch):
    checked = []
    submitted = []
    valid = make_candidate()
    rejected = make_candidate(text="My dog is cute")
    missing = make_candidate(location="")

    async def ensure(*args):
        pass

    async def collect(*args, **kwargs):
        assert args[2]["usRequired"] is True
        return [{}, {}, {}], [rejected, missing, valid], {"provider": "twitterapi"}

    async def verify(candidate, *args):
        checked.append(candidate)
        evidence = json.loads(candidate["targeting_json"])
        evidence["image_verification"] = {"result": "verified", "media_url": candidate["media_url"]}
        return {**candidate, "targeting_json": json.dumps(evidence)}

    def transport(request):
        assert request.url.path.endswith("/complete")  # never send/approve
        submitted.append(json.loads(request.content))
        return httpx.Response(200, json={})

    monkeypatch.setattr(worker, "ensure_pet_image_verifier", ensure)
    monkeypatch.setattr(worker, "collect_twitterapi_search", collect)
    monkeypatch.setattr(worker, "verify_pet_photo", verify)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
            await worker._execute_job(client, {}, Settings(x_lead_provider="twitterapi", diy_site_url="https://test.invalid"),
                "test", {"id": "test", "configuration": {"segments": ["demand_custom"], "usRequired": False}})
    asyncio.run(run())
    assert len(checked) == 1
    result = submitted[0]
    assert result["status"] == "completed"
    assert result["metrics"]["intent_rejected"] == 1
    assert result["metrics"]["intent_location_pending"] == 1
    assert len(result["candidates"]) == 1
    assert result["candidates"][0]["targetingData"]["purchase_intent"]["score"] == 80
    assert result["metrics"]["scene_submitted"] == {"custom": 1}
    assert result["metrics"]["scene_submission_gap"] == {"custom": 19}


def test_scene_caps_never_fill_with_other_scenes_or_duplicate_authors(monkeypatch):
    found = []
    for index, (text, author) in enumerate([
        ("Looking for a portrait of my dog", "same-owner"),
        ("Looking for a photo gift of my dog for my wife", "same-owner"),
        ("Looking for a portrait of my cat", "other-owner"),
        ("Looking for a photo gift of my cat for my wife", "gift-owner"),
    ]):
        candidate = make_candidate(text=text)
        candidate.update(post_id=str(index), author_hash=author)
        found.append(candidate)
    submitted = []

    async def ensure(*args):
        pass

    async def collect(*args, **kwargs):
        return [{}, {}, {}, {}], found, {}

    async def verify(candidate, *args):
        evidence = json.loads(candidate["targeting_json"])
        evidence["image_verification"] = {"result": "verified", "media_url": candidate["media_url"]}
        return {**candidate, "targeting_json": json.dumps(evidence)}

    def handler(request):
        assert request.url.path.endswith("/complete")
        submitted.append(json.loads(request.content))
        return httpx.Response(200, json={})

    monkeypatch.setattr(worker, "ensure_pet_image_verifier", ensure)
    monkeypatch.setattr(worker, "collect_twitterapi_search", collect)
    monkeypatch.setattr(worker, "verify_pet_photo", verify)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await worker._execute_job(client, {}, Settings(x_lead_provider="twitterapi", diy_site_url="https://test.invalid"),
                "test", {"id": "test", "configuration": {
                    "segments": ["demand_custom", "demand_gift", "demand_decor"], "qualifiedPerScene": 1}})

    asyncio.run(run())
    result = submitted[0]
    assert result["status"] == "completed"
    assert len(result["candidates"]) == 2
    assert len({c["authorHash"] for c in result["candidates"]}) == 2
    assert result["metrics"]["scene_submitted"] == {"custom": 1, "gift": 1, "decor": 0}
    assert result["metrics"]["scene_submission_gap"] == {"custom": 0, "gift": 0, "decor": 1}


def test_worker_retries_same_account_photo_after_original_image_fails(monkeypatch):
    original = make_candidate()
    fallback_url = "https://example.com/owner-dog.jpg"
    calls = []
    submitted = []

    async def ensure(*args):
        pass

    async def collect(*args, **kwargs):
        return [{}], [original], {}

    async def attach(candidate, *args, force_search=False, **kwargs):
        calls.append(force_search)
        url = fallback_url if force_search else candidate["media_url"]
        source = {"post_id": "456" if force_search else candidate["post_id"],
                  "post_url": "https://x.com/owner/status/456", "author_id": "owner-id",
                  "author_handle": "owner", "ownership_confidence": 88, "pet_type": "dog"}
        return {**candidate, "media_url": url, "media_urls": [url]}, {url: source}

    async def verify(candidate, *args):
        if candidate["media_url"] != fallback_url:
            return None
        evidence = json.loads(candidate["targeting_json"])
        evidence["image_verification"] = {"result": "verified", "media_url": fallback_url}
        return {**candidate, "targeting_json": json.dumps(evidence)}

    def handler(request):
        submitted.append(json.loads(request.content))
        return httpx.Response(200, json={})

    monkeypatch.setattr(worker, "ensure_pet_image_verifier", ensure)
    monkeypatch.setattr(worker, "collect_twitterapi_search", collect)
    monkeypatch.setattr(worker, "attach_same_account_photo", attach)
    monkeypatch.setattr(worker, "verify_pet_photo", verify)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await worker._execute_job(client, {}, Settings(x_lead_provider="twitterapi", diy_site_url="https://test.invalid"),
                "test", {"id": "test", "configuration": {"segments": ["demand_custom"]}})

    asyncio.run(run())
    assert calls == [False, True]
    assert submitted[0]["metrics"]["image_checked"] == 2
    assert submitted[0]["candidates"][0]["mediaUrl"] == fallback_url
    assert submitted[0]["candidates"][0]["targetingData"]["photo_source"]["relationship"] == "same_account"
