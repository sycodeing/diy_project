from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import datetime, timezone
import json

import httpx

from lead_studio.account_assessment import assess_account
from lead_studio.config import Settings
from probe_account_first import RECENT_PATH, REPLIES_PATH, SEED_PATH, run_account_first_probe


def post(post_id: str, author_id: str, text: str, *, parent: str | None = None,
         bio: str = "", handle: str | None = None) -> dict:
    return {"id": post_id, "text": text, "createdAt": "Sat Nov 21 05:00:00 +0000 2026",
            "author": {"id": author_id, "userName": handle or f"user{author_id}",
                       "profile_bio": {"description": bio}},
            "inReplyToId": parent, "conversationId": parent or post_id, "isReply": bool(parent)}


def assessment(replies: list[dict], recent: list[dict], *, status: str = "complete") -> dict:
    return assess_account("12345", "user12345", replies, recent,
                          seed_id="99999", seed_text="We sell custom pillow covers", timeline_status=status)


def test_account_and_entry_are_separate_and_seed_does_not_count():
    reply = post("10001", "12345", "Lovely!", parent="99999")
    cat = post("10002", "12345", "My cat Luna stole my chair again.")
    tag = post("10003", "12345", "I designed a name tag for Luna; it matches her collar.")
    result = assessment([reply], [cat, tag])
    assert result["accountStatus"] == "potential"
    assert result["entryStatus"] == "ready" or result["entryStatus"] == "no_entry"
    assert result["accountEvidence"]["shopping_intent"] == "unknown"
    assert result["entryEvidence"]["draft_ready"] is False
    assert result["accountEvidence"]["independent_behavior"] is True
    assert assessment([reply], [cat, post("10004", "12345", "Here is my cat")])["accountStatus"] == "watch"
    assert assessment([reply], [cat, cat, cat])["accountStatus"] == "watch"


def test_finished_behavior_and_author_id_isolation():
    cat = post("10002", "12345", "My dog Luna loves the sofa.")
    done = post("10003", "12345", "I commissioned this portrait of my dog last year.")
    result = assessment([], [cat, done])
    assert result["accountStatus"] == "potential"
    assert result["entryStatus"] == "ready"
    assert result["accountEvidence"]["same_product_need_resolved"] is False
    completed = assessment([], [cat, post("10006", "12345", "My custom pillow arrived today")])
    assert completed["accountEvidence"]["same_product_need_resolved"] is True
    assert assessment([], [cat, post("10003", "67890", "I designed a tag for my dog")])["accountStatus"] == "watch"
    assert assessment([], [cat, post("10003", "12345", "If I painted a portrait, it would look terrible")])["accountStatus"] == "watch"
    assert assessment([], [cat, post("10004", "12345", "I painted a portrait of Luna. Thought you might like it.")])["accountStatus"] == "potential"
    shop = post("10005", "12345", "I designed a name tag for my cat.", bio="Shop now. Commissions open")
    assert assessment([], [cat, shop])["accountStatus"] == "excluded"


def test_nobody_inherits_seed_or_nested_parent():
    lovely = post("10001", "12345", "Lovely!", parent="99999")
    assert assessment([lovely], [])["accountStatus"] == "insufficient"
    nested = post("10001", "12345", "My cat is asleep", parent="55555")
    result = assessment([nested], [])
    assert result["accountStatus"] == "watch"
    assert result["entryStatus"] == "context_pending"


def test_archive_first_probe_nested_provider_payload_and_capacity(tmp_path):
    seed = post("99999", "99990", "Show me your dogs")
    seed["replyCount"] = 5
    replies = [post(str(10001 + n), str(12345 + n), "My dog is here", parent="99999") for n in range(5)]
    calls: list[tuple[str, str]] = []

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oapi/my/info":
            return httpx.Response(200, json={"recharge_credits": 10000, "total_bonus_credits": 0})
        calls.append((request.url.path, str(request.url.params)))
        if request.url.path == SEED_PATH:
            return httpx.Response(200, json={"status": "success", "tweets": [seed]})
        if request.url.path == REPLIES_PATH:
            return httpx.Response(200, json={"status": "success", "tweets": [seed, *replies]})
        assert request.url.path == RECENT_PATH
        author_id = request.url.params["userId"]
        return httpx.Response(200, json={"status": "success", "data": {"tweets": [
            post(str(int(author_id) + 20000), author_id, "I designed a tag for my dog"),
            post("99991", "99990", "I designed a tag for my dog")],
            "pin_tweet": post(str(int(author_id) + 20000), author_id, "I designed a tag for my dog")}})

    settings = replace(Settings(), twitterapi_api_key="test", twitterapi_base_url="https://provider.test")
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await run_account_first_probe(client, settings, seed_post_id="99999",
                verification_note="Verified direct invitation with active replies",
                contacted_snapshot={"snapshot_at": "now", "post_ids": [], "author_ids": [], "handles": []},
                archive_dir=tmp_path, now=datetime(2026, 11, 21, 6, tzinfo=timezone.utc))
    result = asyncio.run(run())
    assert result["status"] == "completed"
    assert len(result["account_candidates"]) == 5
    assert len([path for path, _ in calls if path == RECENT_PATH]) == 4
    assert result["account_candidates"][4]["accountEvidence"]["timeline_status"] == "capacity_pending"
    assert result["metrics"]["reserved_credits"] == 1575
    assert result["metrics"]["returned_reply_page_items"] == 6
    assert result["metrics"]["returned_replies"] == 5
    assert [params for path, params in calls if path == REPLIES_PATH] == ["tweetId=99999&cursor=&queryType=Latest"]
    archive = json.loads((tmp_path / f'{result["archive_id"]}.json').read_text(encoding="utf-8"))
    assert len(archive["requests"]) == 6 and archive["requests"][2]["response"]["data"]["pin_tweet"]


def test_v2_reply_page_does_not_turn_seed_or_unrelated_thread_into_participants(tmp_path):
    seed = post("99999", "99990", "Show me your dogs")
    direct = post("10001", "12345", "My dog is here", parent="99999")
    nested = post("10002", "67890", "My cat is here", parent="10001")
    nested["conversationId"] = "99999"
    unrelated = post("10003", "54321", "My dog is here", parent="77777")
    seed_author_reply = post("10004", "99990", "My dog is here", parent="99999")
    calls = []

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oapi/my/info":
            return httpx.Response(200, json={"recharge_credits": 10000})
        calls.append(request.url.path)
        if request.url.path == SEED_PATH:
            return httpx.Response(200, json={"tweets": [seed]})
        if request.url.path == REPLIES_PATH:
            return httpx.Response(200, json={"tweets": [seed, direct, direct, nested, unrelated, seed_author_reply]})
        return httpx.Response(200, json={"data": {"tweets": []}})

    settings = replace(Settings(), twitterapi_api_key="test", twitterapi_base_url="https://provider.test")
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await run_account_first_probe(client, settings, seed_post_id="99999",
                verification_note="Verified original seed with real direct replies",
                contacted_snapshot={"snapshot_at": "now", "post_ids": [], "author_ids": [], "handles": []},
                archive_dir=tmp_path, now=datetime(2026, 11, 21, 6, tzinfo=timezone.utc))
    result = asyncio.run(run())
    assert result["status"] == "completed"
    assert {row["authorId"] for row in result["account_candidates"]} == {"12345", "67890"}
    assert result["metrics"]["returned_replies"] == 2
    by_author = {row["authorId"]: row for row in result["account_candidates"]}
    assert by_author["67890"]["entryStatus"] == "context_pending"
    assert calls == [SEED_PATH, REPLIES_PATH, RECENT_PATH, RECENT_PATH]


def test_provider_business_error_is_not_empty_success(tmp_path):
    seed = post("99999", "99990", "Show me your cats")
    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oapi/my/info":
            return httpx.Response(200, json={"recharge_credits": 10000})
        if request.url.path == SEED_PATH:
            return httpx.Response(200, json={"status": "success", "tweets": [seed]})
        return httpx.Response(200, json={"status": "error", "code": 400, "data": {"tweets": []}})
    settings = replace(Settings(), twitterapi_api_key="test", twitterapi_base_url="https://provider.test")
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await run_account_first_probe(client, settings, seed_post_id="99999",
                verification_note="Verified seed as real conversation thread",
                contacted_snapshot={"snapshot_at": "now", "post_ids": [], "author_ids": [], "handles": []},
                archive_dir=tmp_path, now=datetime(2026, 11, 21, 6, tzinfo=timezone.utc))
    result = asyncio.run(run())
    assert result["status"] == "stopped_provider_error"
    archive = json.loads((tmp_path / f'{result["archive_id"]}.json').read_text(encoding="utf-8"))
    assert archive["requests"][-1]["response"]["status"] == "error"


def test_worker_snapshot_failure_prevents_paid_account_probe(monkeypatch):
    from lead_studio import x_lead_worker as worker
    import probe_account_first
    called = False
    async def forbidden(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("No paid account probe before snapshot")
    monkeypatch.setattr(probe_account_first, "run_account_first_probe", forbidden)
    submitted = []
    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/contacted-snapshot"):
            return httpx.Response(503, json={"error": "snapshot unavailable"})
        submitted.append(json.loads(request.content))
        return httpx.Response(200, json={"ok": True})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            await worker._execute_job(client, {}, replace(Settings(), diy_site_url="https://site.test",
                x_lead_provider="twitterapi"), "worker", {"id": "job", "configuration": {
                    "discoveryMode": "account_first", "classifierVersion": "account-first-v1",
                    "seedPostId": "99999", "seedVerificationNote": "Verified conversation seed"}})
    asyncio.run(run())
    assert called is False
    assert submitted[0]["status"] == "blocked"
    assert submitted[0]["candidates"] == submitted[0]["rawCandidates"] == submitted[0]["accountCandidates"] == []


def test_timeline_failure_keeps_other_reply_authors_without_more_paid_calls(tmp_path):
    seed = post("99999", "99990", "Show me your dogs")
    replies = [post(str(10001 + n), str(12345 + n), "My dog is here", parent="99999") for n in range(3)]
    calls = []
    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oapi/my/info":
            return httpx.Response(200, json={"recharge_credits": 10000})
        calls.append(request.url.path)
        if request.url.path == SEED_PATH:
            return httpx.Response(200, json={"tweets": [seed]})
        if request.url.path == REPLIES_PATH:
            return httpx.Response(200, json={"tweets": replies})
        return httpx.Response(503, json={"status": "error"})
    settings = replace(Settings(), twitterapi_api_key="test", twitterapi_base_url="https://provider.test")
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await run_account_first_probe(client, settings, seed_post_id="99999",
                verification_note="Verified conversation with personal replies",
                contacted_snapshot={"snapshot_at": "now", "post_ids": [], "author_ids": [], "handles": []},
                archive_dir=tmp_path, now=datetime(2026, 11, 21, 6, tzinfo=timezone.utc))
    result = asyncio.run(run())
    assert result["status"] == "stopped_enrichment_error"
    assert len(result["account_candidates"]) == 3
    assert all(row["accountEvidence"]["timeline_status"] == "provider_pending" for row in result["account_candidates"])
    assert calls == [SEED_PATH, REPLIES_PATH, RECENT_PATH]
    archive = json.loads((tmp_path / f'{result["archive_id"]}.json').read_text(encoding="utf-8"))
    assert len(archive["requests"]) == 3


def test_worker_dispatch_submits_account_rows_only(monkeypatch):
    from lead_studio import x_lead_worker as worker
    import probe_account_first
    expected = assessment([], [post("10002", "12345", "My cat is home")])
    expected["sourceArchive"] = "account-first-test"
    expected["sourceHistory"] = [{"archive_id": "account-first-test"}]
    async def fake_probe(*args, **kwargs):
        assert kwargs["seed_post_id"] == "99999"
        return {"status": "completed", "archive_id": "account-first-test",
                "account_candidates": [expected], "metrics": {"returned_replies": 1}}
    monkeypatch.setattr(probe_account_first, "run_account_first_probe", fake_probe)
    submitted = []
    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/contacted-snapshot"):
            return httpx.Response(200, json={"snapshot_at": "now", "post_ids": [], "author_ids": [], "handles": []})
        submitted.append(json.loads(request.content))
        return httpx.Response(200, json={"ok": True})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            await worker._execute_job(client, {}, replace(Settings(), diy_site_url="https://site.test",
                x_lead_provider="twitterapi"), "worker", {"id": "job", "configuration": {
                    "discoveryMode": "account_first", "classifierVersion": "account-first-v1",
                    "seedPostId": "99999", "seedVerificationNote": "Verified conversation seed"}})
    asyncio.run(run())
    assert submitted[0]["status"] == "completed"
    assert submitted[0]["candidates"] == submitted[0]["rawCandidates"] == []
    assert submitted[0]["accountCandidates"] == [expected]
    assert submitted[0]["metrics"]["strict_qualified"] == 0
