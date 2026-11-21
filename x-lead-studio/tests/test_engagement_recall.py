from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import datetime, timezone
import json

import httpx

from lead_studio.config import Settings
from lead_studio.engagement_profiles import assess_engagement_post, finalize_draft_gate, merge_semantic_review
from lead_studio.engagement_semantics import review_text
from probe_engagement_recall import run_engagement_recall_probe
from probe_purchase_recall import extract_raw_reviews


def test_personal_reply_does_not_inherit_seed_purchase_or_draft():
    seed = "We sell custom pet pillows. Order one today."
    cute = assess_engagement_post("Cute! Love it", source="thread_participant",
                                  seed_text=seed, direct_parent=True)
    assert cute["tier"] == "excluded"
    own = assess_engagement_post("Here is my dog Bella", source="thread_participant",
                                 seed_text=seed, direct_parent=True)
    assert own["tier"] == "exploratory"
    assert own["product_relation"] == "thread_context_only"
    assert own["draft_ready"] is False
    nested = assess_engagement_post("Here is my dog Bella", source="thread_participant",
                                    seed_text=seed, direct_parent=False)
    assert nested["direct_parent_status"] == "thread_context_known_direct_parent_unknown"


def test_personal_make_and_model_evidence_fail_closed():
    assert assess_engagement_post("I drew my dog for myself", source="personal_make")["tier"] == "exploratory"
    assert assess_engagement_post("I draw pet portraits, commissions open", source="personal_make",
                                  bio="Custom pet portrait shop")["tier"] == "excluded"
    unverified_use = assess_engagement_post("I made a custom pillow", source="personal_make")
    assert unverified_use["tier"] == "exploratory" and unverified_use["self_use_evidence"] is None
    base = assess_engagement_post("I made a custom pillow for myself. What do you think?",
                                  source="personal_make")
    verdict = {"personal_quote": "I made", "product_quote": "custom pillow",
               "conversation_quote": "What do you think?", "seller": False,
               "fictional_or_nonliteral": False, "specific_product_relation": False,
               "current_need_resolved": False, "personal_use": True}
    reviewed = merge_semantic_review(base, verdict,
        "I made a custom pillow for myself. What do you think?")
    assert finalize_draft_gate(reviewed)["draft_ready"] is False
    positive = {**base, "semantic_status": "reviewed", "semantic_specific_relation": True,
                "semantic_personal_use": True,
                "personal_evidence": "my dog Max", "product_evidence": "photo collage of him for our reading corner",
                "conversation_entry": "Max always steals this seat"}
    assert finalize_draft_gate(positive, media_review={"status": "local_model_review",
        "category": "artwork"})["draft_ready"] is True
    assert finalize_draft_gate(positive, media_review={"status": "pending"})["draft_ready"] is False
    assert merge_semantic_review(base, {**verdict, "personal_quote": "fabricated"},
        "I made a custom pillow for myself. What do you think?")["semantic_status"] == "invalid_evidence"
    assert merge_semantic_review(base, {**verdict, "seller": "false"},
        "I made a custom pillow for myself. What do you think?")["semantic_status"] == "invalid_model_output"
    assert assess_engagement_post("I finished drawing my dog for myself", source="personal_make")["current_need"] == "unknown"
    assert assess_engagement_post("My custom photo pillow cover arrived today", source="pet_share")["current_need"] == "resolved_same_catalog_product"


def test_full_positive_draft_path_without_buying_or_question():
    own = "My dog Max always steals this seat. I made this photo collage of him for our reading corner."
    intent = assess_engagement_post(own, source="personal_make")
    verdict = {"personal_quote": "My dog Max", "product_quote": "photo collage of him for our reading corner",
               "conversation_quote": "Max always steals this seat", "seller": False,
               "fictional_or_nonliteral": False, "specific_product_relation": True,
               "current_need_resolved": False, "personal_use": True}
    reviewed = merge_semantic_review(intent, verdict, own)
    ready = finalize_draft_gate(reviewed, media_review={"status": "local_model_review", "category": "artwork"})
    assert ready["draft_ready"] is True
    assert ready["human_approved"] is False and ready["contact_permission"] is False
    assert finalize_draft_gate(reviewed)["draft_ready"] is False


def test_model_denied_personal_use_cannot_inherit_regex():
    own = "I made a custom photo pillow cover for my dog as a commission. The blue background suits him."
    intent = assess_engagement_post(own, source="personal_make")
    verdict = {"personal_quote": "I made", "product_quote": "custom photo pillow cover",
               "conversation_quote": "The blue background suits him", "seller": False,
               "fictional_or_nonliteral": False, "specific_product_relation": True,
               "current_need_resolved": False, "personal_use": False}
    reviewed = merge_semantic_review(intent, verdict, own)
    assert reviewed["self_use_evidence"] is None
    assert finalize_draft_gate(reviewed)["draft_ready"] is False


def test_non_object_model_json_stays_pending():
    settings = replace(Settings(), pet_image_verifier="ollama", ollama_vision_model="mock-model")
    intent = assess_engagement_post("My dog Max sleeps on the sofa", source="pet_share")
    def reply(request):
        return httpx.Response(200, json={"message": {"content": "[]"}})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as client:
            return await review_text(client, settings, intent, "My dog Max sleeps on the sofa", "")
    reviewed = asyncio.run(run())
    assert reviewed["semantic_status"] == "invalid_model_output"
    assert finalize_draft_gate(reviewed)["draft_ready"] is False


def test_five_paid_pages_archive_seed_and_actual_replies(tmp_path):
    now = datetime(2026, 11, 21, 12, tzinfo=timezone.utc)
    stamp = now.isoformat()

    def post(id: int, author: int, text: str, **extra):
        return {"id": str(id), "text": text, "createdAt": stamp,
                "author": {"id": str(author), "userName": f"person{author}"}, **extra}

    calls: list[str] = []

    def handler(request: httpx.Request):
        path = request.url.path
        if path == "/oapi/my/info":
            return httpx.Response(200, json={"recharge_credits": 25000, "total_bonus_credits": 0})
        calls.append(path)
        if path.endswith("/advanced_search"):
            query = str(request.url.params.get("query") or "")
            if "custom pet pillow" in query:
                posts = [post(200, 20, "Our shop sells custom pet pillows", replyCount=4),
                         post(201, 21, "Custom photo gift ideas", replyCount=3)]
            elif "I made" in query:
                posts = [post(300, 30, "I drew my dog for myself")]
            else:
                posts = [post(100, 10, "My cat sleeps on my sofa")]
        else:
            seed = request.url.params["tweetId"]
            posts = ([post(400, 40, "Cute!", isReply=True, inReplyToId=seed),
                      post(401, 41, "Here is my dog Bella", isReply=True, inReplyToId=seed)]
                     if seed == "200" else
                     [post(402, 42, "Here is my cat", isReply=True, inReplyToId="399")])
        return httpx.Response(200, json={"status": "success", "tweets": posts,
                                         "has_next_page": True, "next_cursor": "ignored"})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await run_engagement_recall_probe(client,
                Settings(twitterapi_api_key="test", pet_image_verifier="manual"),
                contacted_snapshot={"snapshot_at": stamp, "post_ids": [],
                                    "author_ids": [], "handles": []},
                archive_dir=tmp_path, now=now)

    summary = asyncio.run(run())
    assert summary["status"] == "completed"
    assert summary["search_pages"] == 5
    assert len(calls) == 5 and sum(path.endswith("/replies") for path in calls) == 2
    assert summary["max_static_provider_cost"] == 1500
    archive = json.loads((tmp_path / f'{summary["archive_id"]}.json').read_text(encoding="utf-8"))
    assert len(archive["queries"]) == 5
    assert archive["queries"][1]["role"] == "seed"
    rows = extract_raw_reviews([tmp_path / f'{summary["archive_id"]}.json'])
    by_id = {row["postId"]: row for row in rows}
    assert "200" not in by_id and "201" not in by_id
    assert by_id["401"]["parentEvidence"] == "Our shop sells custom pet pillows"
    assert by_id["402"]["parentEvidence"] is None
    assert by_id["402"]["intent"]["direct_parent_status"] == "thread_context_known_direct_parent_unknown"
    assert by_id["400"]["classifierTier"] == "excluded"
    assert all(row["intent"]["draft_ready"] is False for row in rows)


def test_resume_reuses_first_page_and_caps_all_six_attempts(tmp_path):
    now = datetime(2026, 11, 21, 12, tzinfo=timezone.utc)
    stamp = now.isoformat()
    calls = []
    fail_seed_once = True

    def post(id, author, text, **extra):
        return {"id": str(id), "text": text, "createdAt": stamp,
                "author": {"id": str(author), "userName": f"person{author}"}, **extra}

    def handler(request):
        nonlocal fail_seed_once
        if request.url.path == "/oapi/my/info":
            return httpx.Response(200, json={"recharge_credits": 25000, "total_bonus_credits": 0})
        calls.append((request.url.path, str(request.url.params.get("query") or "")))
        if "custom pet pillow" in calls[-1][1] and fail_seed_once:
            fail_seed_once = False
            return httpx.Response(503, json={"detail": "Please retry; not charged"})
        if "custom pet pillow" in calls[-1][1]:
            posts = [post(200, 20, "Custom pet pillow thread", replyCount=4),
                     post(201, 21, "Photo pillow cover thread", replyCount=3)]
        elif "I made" in calls[-1][1]:
            posts = [post(300, 30, "I drew my dog for myself")]
        elif request.url.path.endswith("/replies"):
            posts = [post(400 + len(calls), 40 + len(calls), "Here is my dog Bella",
                          isReply=True, inReplyToId=request.url.params["tweetId"])]
        else:
            posts = [post(100, 10, "My cat sleeps on my sofa")]
        return httpx.Response(200, json={"tweets": posts})

    async def run(resume_from=None):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await run_engagement_recall_probe(client,
                Settings(twitterapi_api_key="test", pet_image_verifier="manual"),
                contacted_snapshot={"snapshot_at": stamp, "post_ids": [],
                                    "author_ids": [], "handles": []},
                archive_dir=tmp_path, now=now, resume_from=resume_from)

    first = asyncio.run(run())
    assert first["status"] == "stopped_provider_error" and len(calls) == 2
    first_path = tmp_path / f'{first["archive_id"]}.json'
    original_bytes = first_path.read_bytes()
    resumed = asyncio.run(run(first_path))
    assert resumed["status"] == "completed"
    assert resumed["search_pages"] == 6 and resumed["new_request_pages"] == 4
    assert resumed["reused_post_ids"] == 1 and resumed["resume_new_posts"] == 3
    assert resumed["max_static_provider_cost"] == 1800
    assert len(calls) == 6 and sum("my dog" in query for _, query in calls) == 1
    assert first_path.read_bytes() == original_bytes
    new_path = tmp_path / f'{resumed["archive_id"]}.json'
    document = json.loads(new_path.read_text(encoding="utf-8"))
    assert document["resume_of"] == first["archive_id"]
    assert document["queries"][0]["role"] == "reused"
    assert "100" not in {row["postId"] for row in extract_raw_reviews([new_path])}
    assert "100" in {row["postId"] for row in extract_raw_reviews([first_path])}
