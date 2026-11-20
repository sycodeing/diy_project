import asyncio
from datetime import datetime, timezone
import json

import httpx

from lead_studio.config import Settings
from lead_studio.consumer_profiles import assess_consumer_profile
from probe_consumer_recall import QUERY_TIERS, run_consumer_recall_probe
from probe_purchase_recall import extract_raw_reviews


NOW = datetime(2026, 11, 20, 8, tzinfo=timezone.utc)
SNAPSHOT = {"snapshot_at": NOW.isoformat(), "post_ids": [], "author_ids": [], "handles": []}


def _post(post_id, text, handle=None):
    return {"id": str(post_id), "createdAt": "Fri Nov 20 07:00:00 +0000 2026",
            "text": text, "author": {"id": str(post_id + 1000), "userName": handle or f"user{post_id}"}}


def test_three_personas_and_boundaries():
    cases = [
        ("I'm planning a graduation gift for my sister using a photo of us.", "gift_giver", "open"),
        ("Happy birthday to my sister!", None, "unknown"),
        ("Ordered her custom photo pillow yesterday. Gift sorted.", None, "unknown"),
        ("I collect car merch; these are the keychains I bought this year.", "identity_consumer", "unknown"),
        ("I've bought concert merch for years and want something with my own guitar on it.", "identity_consumer", "open"),
        ("I love cars. Look at my new avatar.", None, "unknown"),
        ("My custom car pillow just arrived, exactly what I wanted.", None, "unknown"),
        ("I'm organizing our book club anniversary for 12 people next month, thinking about keepsakes with everyone's name.", "group_organizer", "open"),
        ("Had fun at our club dinner.", None, "unknown"),
        ("We sell personalized graduation gifts, order from our shop.", None, "unknown"),
        ("I want to be famous. I love anime merch.", None, "unknown"),
        ("I'm planning a gift for my sister: I'm sewing her a pillow myself.", None, "unknown"),
        ("I've already bought concert posters for years and now I'm choosing a custom photo pillow cover with my guitar.", "identity_consumer", "open"),
    ]
    for text, persona, current_need in cases:
        intent = assess_consumer_profile(text)
        assert (intent["persona"], intent["current_need"]) == (persona, current_need), text
        assert intent["contact_permission"] is False
    assert assess_consumer_profile(cases[-1][0])["product_fit"] == "verified"
    assert assess_consumer_profile(cases[7][0])["product_fit"] == "unknown"
    unrelated_gift = assess_consumer_profile("I'm looking for a keychain to buy as a gift for my friend.")
    assert unrelated_gift["persona"] == "gift_giver"
    assert unrelated_gift["specific_other_product"] is True
    assert unrelated_gift["product_fit"] == "unknown"
    assert unrelated_gift["priority"] == "low"
    no_pillow = assess_consumer_profile("I'm choosing a keychain as a gift for my friend, not a pillow.")
    assert no_pillow["specific_other_product"] is True
    assert no_pillow["product_fit"] == "unknown"


def test_six_distinct_pages_archive_and_contacted_exclusion(tmp_path):
    calls = []
    def handler(request):
        if request.url.path.endswith("/oapi/my/info"):
            return httpx.Response(200, json={"total_bonus_credits": 10000})
        calls.append(request.url.params["query"])
        number = len(calls)
        text = "I'm planning a graduation gift for my sister using a photo of us."
        return httpx.Response(200, json={"tweets": [_post(number, text)], "has_next_page": True,
                                          "next_cursor": "would-cost-an-extra-page"})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await run_consumer_recall_probe(client, Settings(twitterapi_api_key="test"),
                                                   contacted_snapshot={**SNAPSHOT, "handles": ["user2"]},
                                                   archive_dir=tmp_path, now=NOW)

    summary = asyncio.run(run())
    assert len(calls) == 6
    assert [name for name, _ in QUERY_TIERS] == ["gift_giver_1", "identity_consumer_1",
        "group_organizer_1", "gift_giver_2", "identity_consumer_2", "group_organizer_2"]
    assert summary["retrieved_new_posts"] == 6
    assert summary["contacted_excluded"] == 1
    assert summary["persona_unique_authors"]["gift_giver"] == 5
    assert summary["strict_qualified"] == 0
    archive = tmp_path / f'{summary["archive_id"]}.json'
    document = json.loads(archive.read_text(encoding="utf-8"))
    assert all(len(q["pages"]) == 1 for q in document["queries"])
    rows = extract_raw_reviews([archive])
    assert len(rows) == 6
    assert next(row for row in rows if row["handle"] == "user2")["classifierTier"] == "excluded"
    assert all(row["classifierVersion"] == "consumer-personas-v1.1" for row in rows)


def test_snapshot_failure_does_not_call_paid_api(tmp_path):
    def handler(request):
        raise AssertionError("No paid or credit request permitted")
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await run_consumer_recall_probe(client, Settings(twitterapi_api_key="test"),
                                                   contacted_snapshot={}, archive_dir=tmp_path, now=NOW)
    try:
        asyncio.run(run())
    except ValueError as error:
        assert "snapshot" in str(error)
    else:
        raise AssertionError("Missing contacted snapshot should fail closed")


def test_worker_blocks_without_contact_snapshot_and_never_emits_strict_candidates(monkeypatch):
    from lead_studio import x_lead_worker as worker
    import probe_consumer_recall as recall
    called = False
    async def unexpected_probe(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("Paid probe must not run without contacted snapshot")
    monkeypatch.setattr(recall, "run_consumer_recall_probe", unexpected_probe)
    submissions = []
    def handler(request):
        if request.url.path.endswith("/contacted-snapshot"):
            return httpx.Response(503, json={"error": "snapshot unavailable"})
        submissions.append(json.loads(request.content))
        return httpx.Response(200, json={"ok": True})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await worker._execute_job(client, {}, Settings(x_lead_provider="twitterapi",
                diy_site_url="https://test.invalid"), "worker",
                {"id": "job", "configuration": {"discoveryMode": "consumer_recall"}})
    asyncio.run(run())
    assert called is False
    assert len(submissions) == 1
    assert submissions[0]["status"] == "blocked"
    assert submissions[0]["candidates"] == []
    assert submissions[0]["rawCandidates"] == []
