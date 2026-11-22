from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json

import httpx

from lead_studio.config import Settings
from probe_account_first import (
    RECENT_PATH, REPLIES_PATH, SEED_PATH, _cached_timeline, _timeline_cache_key,
    run_account_first_probe,
)


NOW = datetime.now(timezone.utc)


def post(post_id: str, author_id: str, text: str, *, parent: str | None = None) -> dict:
    created = (NOW - timedelta(hours=1)).strftime("%a %b %d %H:%M:%S +0000 %Y")
    return {"id": post_id, "text": text, "createdAt": created,
            "author": {"id": author_id, "userName": f"user{author_id}"},
            "inReplyToId": parent, "conversationId": parent or post_id,
            "isReply": bool(parent)}


def run_probe(tmp_path, settings: Settings, calls: list, *, seed_id: str = "99999",
              contacted_ids: list[str] | None = None, now: datetime = NOW,
              timeline_payload: dict | None = None, credits: int = 5000):
    seed = post(seed_id, "99990", "Show me your cat")
    reply = post(str(int(seed_id) + 1), "12345", "My cat Luna is here", parent=seed_id)

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oapi/my/info":
            return httpx.Response(200, json={"recharge_credits": credits})
        calls.append((str(request.url.host), request.url.path, str(request.url.params)))
        if request.url.path == SEED_PATH:
            return httpx.Response(200, json={"tweets": [seed]})
        if request.url.path == REPLIES_PATH:
            return httpx.Response(200, json={"tweets": [reply]})
        return httpx.Response(200, json=timeline_payload or {"data": {"tweets": [
            post("77777", "12345", "I designed a name tag for my cat Luna")],
            "pin_tweet": None}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await run_account_first_probe(
                client, settings, seed_post_id=seed_id,
                verification_note="Reviewer verified this original conversation",
                contacted_snapshot={"snapshot_at": "fresh", "post_ids": [],
                                    "author_ids": contacted_ids or [], "handles": []},
                archive_dir=tmp_path, now=now)
    return asyncio.run(run())


def settings(**kwargs) -> Settings:
    return replace(Settings(), twitterapi_api_key="test-key", twitterapi_base_url="https://provider.test",
                   **kwargs)


def test_same_author_new_seed_reuses_raw_page_and_reassesses(tmp_path):
    calls = []
    first = run_probe(tmp_path, settings(), calls)
    second = run_probe(tmp_path, settings(), calls, seed_id="88888",
                       now=NOW + timedelta(minutes=5))
    assert first["status"] == second["status"] == "completed"
    assert len([c for c in calls if c[1] == RECENT_PATH]) == 1
    assert len([c for c in calls if c[1] in (SEED_PATH, REPLIES_PATH)]) == 4
    assert first["metrics"]["paid_requests"] == 3
    assert second["metrics"]["paid_requests"] == 2
    assert second["metrics"]["timeline_cache_hits"] == 1
    assert second["metrics"]["estimated_avoided_credits"] == 15
    assert second["account_candidates"][0]["sourceHistory"][0]["seed_post_id"] == "88888"
    archive = json.loads((tmp_path / f'{second["archive_id"]}.json').read_text(encoding="utf-8"))
    reuse = archive["cache_reuses"][0]
    assert reuse["source_archive_id"] == first["archive_id"]
    assert reuse["provider_received_at"] and reuse["source_request_index"] == 2
    assert len(archive["requests"]) == 2
    # A new contacted snapshot still excludes the same author before cache lookup.
    run_probe(tmp_path, settings(), calls, seed_id="77779", contacted_ids=["12345"],
              now=NOW + timedelta(minutes=10))
    assert len([c for c in calls if c[1] == RECENT_PATH]) == 1


def test_cache_key_isolates_full_request_base_url_and_credential(tmp_path):
    calls = []
    original = settings()
    run_probe(tmp_path, original, calls)
    params = {"userId": "12345", "cursor": "", "includeReplies": "false"}
    baseline = _timeline_cache_key(original, RECENT_PATH, params)
    assert baseline != _timeline_cache_key(original, RECENT_PATH, {**params, "includeReplies": "true"})
    assert baseline != _timeline_cache_key(original, RECENT_PATH, {**params, "cursor": "next"})
    assert baseline != _timeline_cache_key(original, RECENT_PATH, {**params, "userId": "67890"})
    assert baseline != _timeline_cache_key(original, REPLIES_PATH, params)
    assert baseline != _timeline_cache_key(replace(original, twitterapi_base_url="https://other.test"), RECENT_PATH, params)
    assert baseline != _timeline_cache_key(replace(original, twitterapi_api_key="other-key"), RECENT_PATH, params)
    for change in ({"twitterapi_base_url": "https://other.test"},
                   {"twitterapi_api_key": "other-key"}):
        run_probe(tmp_path, replace(original, **change), calls,
                  now=NOW + timedelta(minutes=5))
    assert len([c for c in calls if c[1] == RECENT_PATH]) == 3


def test_bad_expired_future_or_wrong_author_cache_is_not_reused(tmp_path):
    calls = []
    config = settings()
    run_probe(tmp_path, config, calls)
    params = {"userId": "12345", "cursor": "", "includeReplies": "false"}
    key = _timeline_cache_key(config, RECENT_PATH, params)
    cache_file = tmp_path / "account-first-timeline-cache" / f"{key}.json"
    good = json.loads(cache_file.read_text(encoding="utf-8"))
    cases = [
        {**good, "cache_key": "wrong-key"},
        {**good, "source_archive_id": ""},
        {**good, "provider_received_at": (NOW - timedelta(hours=7)).isoformat()},
        {**good, "provider_received_at": (NOW + timedelta(hours=1)).isoformat()},
        {**good, "provider_received_at": "not-a-date"},
        {**good, "response": {"status": "error", "data": {"tweets": []}}},
        {**good, "response": {"data": {"tweets": [post("77777", "67890", "Not this author")]}}},
        {**good, "response": {"data": {"tweets": "invalid"}}},
    ]
    for entry in cases:
        cache_file.write_text(json.dumps(entry), encoding="utf-8")
        assert _cached_timeline(cache_file.parent, key, "12345", NOW, 6) is None
    cache_file.write_text("{bad json", encoding="utf-8")
    result = run_probe(tmp_path, config, calls, now=NOW + timedelta(minutes=5))
    assert result["metrics"]["timeline_cache_hits"] == 0
    assert len([c for c in calls if c[1] == RECENT_PATH]) == 2


def test_force_refresh_and_disabled_ttl_fetch_fresh_page(tmp_path):
    calls = []
    run_probe(tmp_path, settings(), calls)
    refreshed = run_probe(tmp_path, settings(twitterapi_account_timeline_force_refresh=True),
                          calls, now=NOW + timedelta(minutes=5))
    disabled = run_probe(tmp_path, settings(twitterapi_account_timeline_cache_hours=0),
                         calls, now=NOW + timedelta(minutes=10))
    assert refreshed["metrics"]["timeline_cache_hits"] == 0
    assert disabled["metrics"]["timeline_cache_hits"] == 0
    assert len([c for c in calls if c[1] == RECENT_PATH]) == 3


def test_cache_hit_needs_no_timeline_reserve_but_miss_stops_at_floor(tmp_path):
    calls = []
    config = settings()
    run_probe(tmp_path, config, calls)
    hit = run_probe(tmp_path, config, calls, seed_id="88888", credits=3400)
    assert hit["status"] == "completed"
    assert hit["metrics"]["paid_requests"] == 2
    assert hit["metrics"]["timeline_cache_hits"] == 1
    assert len([c for c in calls if c[1] == RECENT_PATH]) == 1
    miss = run_probe(tmp_path, settings(twitterapi_account_timeline_force_refresh=True),
                     calls, seed_id="77779", credits=3400)
    assert miss["status"] == "stopped_enrichment_error"
    assert miss["metrics"]["paid_requests"] == 2
    assert miss["account_candidates"][0]["accountEvidence"]["timeline_status"] == "provider_pending"
    assert len([c for c in calls if c[1] == RECENT_PATH]) == 1


def test_failed_or_wrong_author_timeline_never_enters_cache(tmp_path):
    calls = []
    error = {"status": "error", "code": 500, "data": {"tweets": []}}
    failed = run_probe(tmp_path, settings(), calls, timeline_payload=error)
    assert failed["status"] == "stopped_enrichment_error"
    assert not list((tmp_path / "account-first-timeline-cache").glob("*.json"))
    wrong = run_probe(tmp_path, settings(), calls, timeline_payload={"data": {"tweets": [
        post("77777", "67890", "Not this author")]}})
    assert wrong["status"] == "completed"
    assert not list((tmp_path / "account-first-timeline-cache").glob("*.json"))
