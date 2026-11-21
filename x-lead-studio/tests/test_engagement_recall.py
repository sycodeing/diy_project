from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import datetime, timezone
import json

import httpx

from lead_studio.config import Settings
from lead_studio.engagement_profiles import assess_engagement_post, finalize_draft_gate, merge_semantic_review
from lead_studio.engagement_semantics import review_text
from probe_engagement_recall import QUERY_REVISION, SEED_QUERIES, _eligible_seed, run_engagement_recall_probe
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


def test_direct_pet_invitation_short_photo_caption_stays_ownership_pending():
    invited = assess_engagement_post("Milo", source="thread_participant",
        seed_text="Show me your cats!", direct_parent=True,
        verified_pet_invitation=True, own_photo_count=1)
    assert invited["tier"] == "exploratory"
    assert invited["contextual_self_report_pending"] is True
    assert invited["needs_context_review"] is True
    assert invited["media_eligibility"] == "pending_ownership"
    assert finalize_draft_gate(invited)["draft_ready"] is False
    for caption in ("Milo https://t.co/abc", "@seed Milo https://t.co/abc", "https://t.co/abc"):
        contextual = assess_engagement_post(caption, source="thread_participant",
            seed_text="Show me your cats!", direct_parent=True,
            verified_pet_invitation=True, own_photo_count=1)
        assert contextual["tier"] == "exploratory"
        assert contextual["draft_ready"] is False
    for kwargs, caption in [({"own_photo_count": 0}, "Milo"),
                            ({"direct_parent": False, "own_photo_count": 1}, "Milo"),
                            ({"own_photo_count": 0}, "😍"),
                            ({"own_photo_count": 1}, "Cute!")]:
        result = assess_engagement_post(caption, source="thread_participant",
            seed_text="Show me your cats!", verified_pet_invitation=True,
            **{"direct_parent": True, **kwargs})
        assert result["tier"] == "excluded"


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


def test_seed_query_uses_local_reply_count_and_rejects_imaginary_pet_challenge():
    assert all("min_replies:" not in query for _, query in SEED_QUERIES[:2])
    assert _eligible_seed({"text": "Show me your cats! I used an AI tool for the poster."},
                          "pet_photo_invite_seed")
    assert not _eligible_seed({"text": "Show me your cat the way you imagine below. Try my AI prompt in different AI models."},
                              "pet_photo_invite_seed")
    assert _eligible_seed({"text": "I painted this AI cat portrait. Thoughts?"},
                          "pet_art_discussion_seed")


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
            if "show me" in query:
                posts = [post(99, 9, "Show me your dog!", replyCount=0),
                         post(100, 10, "Show me your cats! Drop your pet photo", replyCount=4)]
            elif "pet portrait" in query:
                posts = [post(200, 20, "I painted this dog portrait. Thoughts?", replyCount=3)]
            elif "I drew my" in query:
                posts = [post(300, 30, "I drew my dog for myself"),
                         post(301, 10, "I drew my cat for myself")]
            else:
                posts = []
        else:
            seed = request.url.params["tweetId"]
            posts = ([post(400, 40, "Cute!", isReply=True, inReplyToId=seed),
                      post(401, 41, "Milo", isReply=True, inReplyToId=seed,
                           extendedEntities={"media": [{"type": "photo", "media_url_https": "https://pbs.twimg.com/media/abc.jpg"}]})]
                     + [post(410+i, 50+i, "Here is my dog", isReply=True, inReplyToId=seed) for i in range(10)]
                     if seed == "100" else
                     [post(402, 42, "Here is my cat", isReply=True, inReplyToId="399")]
                     + [post(430+i, 70+i, "Here is my cat", isReply=True, inReplyToId=seed) for i in range(10)])
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
    assert summary["group_authors"]["thread_participant"] == 20
    archive = json.loads((tmp_path / f'{summary["archive_id"]}.json').read_text(encoding="utf-8"))
    assert len(archive["queries"]) == 5
    assert archive["queries"][0]["role"] == "seed"
    assert archive["configuration"]["queryRevision"] == QUERY_REVISION
    assert all("min_replies:" not in q["query"] for q in archive["queries"][:2])
    assert all(q["seed_post_id"] != "99" for q in archive["queries"] if q["role"] == "participant")
    rows = extract_raw_reviews([tmp_path / f'{summary["archive_id"]}.json'])
    by_id = {row["postId"]: row for row in rows}
    assert "100" not in by_id and "200" not in by_id
    assert by_id["401"]["parentEvidence"] == "Show me your cats! Drop your pet photo"
    assert by_id["401"]["intent"]["contextual_self_report_pending"] is True
    assert by_id["401"]["intent"]["media_eligibility"] == "pending_ownership"
    assert by_id["402"]["parentEvidence"] is None
    assert by_id["402"]["intent"]["direct_parent_status"] == "thread_context_known_direct_parent_unknown"
    assert by_id["400"]["classifierTier"] == "excluded"
    assert by_id["301"]["classifierTier"] == "excluded"
    assert "seed_author_context_only" in by_id["301"]["exclusionReasons"]
    assert "418" not in by_id and "439" not in by_id  # later authors reserved beyond each seed's 10
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
        if "pet portrait" in calls[-1][1] and fail_seed_once:
            fail_seed_once = False
            return httpx.Response(503, json={"detail": "Please retry; not charged"})
        if "pet portrait" in calls[-1][1]:
            posts = [post(200, 20, "I painted a dog portrait. Thoughts?", replyCount=4)]
        elif "I drew my" in calls[-1][1]:
            posts = [post(300, 30, "I drew my dog for myself")]
        elif request.url.path.endswith("/replies"):
            posts = [post(400 + len(calls), 40 + len(calls), "Here is my dog Bella",
                          isReply=True, inReplyToId=request.url.params["tweetId"])]
        else:
            posts = [post(100, 10, "Show me your dog photos!", replyCount=4)]
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
    assert resumed["reused_success_pages"] == 1 and resumed["resume_new_posts"] == 3
    assert resumed["max_static_provider_cost"] == 1800
    assert len(calls) == 6 and sum("show me" in query for _, query in calls) == 1
    assert first_path.read_bytes() == original_bytes
    new_path = tmp_path / f'{resumed["archive_id"]}.json'
    document = json.loads(new_path.read_text(encoding="utf-8"))
    assert document["resume_of"] == first["archive_id"]
    assert document["queries"][0]["role"] == "reused"
    assert "100" not in {row["postId"] for row in extract_raw_reviews([new_path])}
    assert "100" not in {row["postId"] for row in extract_raw_reviews([first_path])}
