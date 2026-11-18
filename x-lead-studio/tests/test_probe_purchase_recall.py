import asyncio
from datetime import datetime, timezone
import json

import httpx

from lead_studio.config import Settings
from probe_purchase_recall import RecallProbeError, extract_raw_reviews, historical_ids, run_recall_probe


NOW = datetime(2026, 11, 18, 8, tzinfo=timezone.utc)


def _post(post_id, date="Wed Nov 18 07:30:00 +0000 2026", text="Where can I order a custom dog pillow?"):
    return {"id": post_id, "createdAt": date, "text": text,
            "author": {"id": f"author-{post_id}", "userName": f"user{post_id}"}}


def test_history_includes_parent_context_and_nested_quoted_post(tmp_path):
    archive = {"queries": [{"pages": [{"response": {"tweets": [
        {**_post("1"), "quotedTweet": _post("2")},
    ]}}], "parent_contexts": [{"response": {"tweets": [_post("3")]}}]}]}
    (tmp_path / "prior.json").write_text(json.dumps(archive), encoding="utf-8")
    ids, authors, count = historical_ids(tmp_path)
    assert count == 1
    assert ids == {"1", "2", "3"}
    assert authors == {"author-1", "author-2", "author-3"}
    bare = {"tweets": [{**_post("4"), "quoted_tweet": _post("5")}]}
    (tmp_path / "raw-parent.json").write_text(json.dumps(bare), encoding="utf-8")
    ids, _, count = historical_ids(tmp_path)
    assert count == 2
    assert ids == {"1", "2", "3", "4", "5"}


def test_recall_falls_back_after_empty_or_stale_pages_and_preserves_raw(tmp_path):
    calls = []
    responses = [
        {"tweets": [], "has_next_page": False},
        {"tweets": [_post("old", "Mon Oct 26 18:00:00 +0000 2026")], "has_next_page": True,
         "next_cursor": "older"},
        {"tweets": [], "has_next_page": False},
        {"tweets": [_post("new")], "has_next_page": False},
    ]

    def handler(request):
        if request.url.path.endswith("/oapi/my/info"):
            return httpx.Response(200, json={"total_bonus_credits": 10000})
        assert request.url.path.endswith("advanced_search")
        calls.append(request.url.params["query"])
        return httpx.Response(200, json=responses[len(calls) - 1])

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await run_recall_probe(client, Settings(twitterapi_api_key="test"),
                                          archive_dir=tmp_path, max_pages=4, target_new_posts=1, now=NOW)

    summary = asyncio.run(run())
    assert len(calls) == 4
    assert all("since_time:" in query and "until_time:" in query for query in calls)
    assert summary["shopping_query_new_posts_vs_baseline"] == 1
    assert summary["raw_new_post_ids_including_invalid_dates"] == 2
    assert summary["shopping_text_demand_new_posts"] == 1
    assert summary["strict_qualified"] == 0
    archive = json.loads((tmp_path / f'{summary["archive_id"]}.json').read_text(encoding="utf-8"))
    assert archive["queries"][1]["counts"]["out_of_window_or_invalid"] == 1
    assert archive["queries"][1]["pages"][0]["response"]["tweets"][0]["id"] == "old"
    assert archive["queries"][0]["name"] == "shopping_pet_product"  # control is opt-in


def test_invalid_payload_stops_without_a_retry(tmp_path):
    searches = []

    def handler(request):
        if request.url.path.endswith("/oapi/my/info"):
            return httpx.Response(200, json={"total_bonus_credits": 10000})
        searches.append(request)
        return httpx.Response(200, json={"status": "success"})  # missing tweets != empty search

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await run_recall_probe(client, Settings(twitterapi_api_key="test"),
                                          archive_dir=tmp_path, max_pages=8, now=NOW)

    summary = asyncio.run(run())
    assert summary["status"] == "stopped_invalid_payload"
    assert summary["search_pages"] == len(searches) == 1


def test_raw_review_extracts_only_shopping_and_keeps_verified_parent(tmp_path):
    reply = {**_post("2122748134531166384", text="Would you recommend this pillow?"),
             "inReplyToId": "2122672037684486452"}
    query = {"role": "shopping", "name": "buyer_recommend_pillow", "pages": [
        {"response": {"tweets": [reply]}}], "decisions": [
            {"post_id": reply["id"], "intent": {"tier": "excluded"}}]}
    control = {"role": "control", "name": "control", "pages": [
        {"response": {"tweets": [_post("999")]}}]}
    search_path = tmp_path / "search.json"
    search_path.write_text(json.dumps({"queries": [control, query]}), encoding="utf-8")
    parent_path = tmp_path / "parent.json"
    parent_path.write_text(json.dumps({
        "kind": "single_parent_context_query_only", "reply_post_id": reply["id"],
        "parent_post_id": reply["inReplyToId"], "response": {"tweets": [{
            "id": reply["inReplyToId"], "text": "These ordinary pillows",
            "entities": {"urls": [{"expanded_url": "https://example.org/pillow"}]},
        }]},
    }), encoding="utf-8")
    rows = extract_raw_reviews([search_path, parent_path])
    assert len(rows) == 1
    assert rows[0]["postId"] == reply["id"]
    assert rows[0]["parentStatus"] == "resolved_product_mismatch"
    assert "https://example.org/pillow" in rows[0]["parentEvidence"]


def test_failed_later_page_retains_own_archive_raw_rows_for_worker(tmp_path, monkeypatch):
    from lead_studio import x_lead_worker as worker
    import probe_purchase_recall as recall

    archive_path = tmp_path / "purchase-recall-own.json"
    post = _post("123")
    archive_path.write_text(json.dumps({"queries": [{
        "role": "shopping", "name": "shopping_pet_product", "pages": [
            {"response": {"tweets": [post]}}],
        "decisions": [{"post_id": "123", "intent": {"tier": "explicit_request"}}],
    }], "summary": {"search_pages": 2, "shopping_query_new_posts_vs_baseline": 1}}), encoding="utf-8")

    async def failed_probe(*args, **kwargs):
        raise RecallProbeError(archive_path, httpx.ConnectError("provider unavailable"))

    monkeypatch.setattr(recall, "run_recall_probe", failed_probe)
    submissions = []

    def handler(request):
        submissions.append(json.loads(request.content))
        return httpx.Response(200, json={"ok": True})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await worker._execute_job(client, {}, Settings(x_lead_provider="twitterapi", diy_site_url="https://test.invalid"),
                                      "worker", {"id": "job", "configuration": {"discoveryMode": "purchase_recall"}})

    asyncio.run(run())
    assert len(submissions) == 1
    assert submissions[0]["status"] == "blocked"
    assert submissions[0]["candidates"] == []
    assert len(submissions[0]["rawCandidates"]) == 1
    assert submissions[0]["metrics"]["archive_path"] == str(archive_path)
