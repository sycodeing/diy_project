import asyncio
from datetime import datetime, timezone
import json

import httpx

from lead_studio.config import Settings
from lead_studio.consumer_profiles import assess_consumer_profile
from probe_consumer_recall import QUERY_TIERS, run_consumer_recall_probe
from probe_purchase_recall import extract_raw_reviews
from reclassify_consumer_archive import reclassify_archive


NOW = datetime(2026, 11, 20, 8, tzinfo=timezone.utc)
SNAPSHOT = {"snapshot_at": NOW.isoformat(), "post_ids": [], "author_ids": [], "handles": []}


def _post(post_id, text, handle=None):
    return {"id": str(post_id), "createdAt": "Fri Nov 20 07:00:00 +0000 2026",
            "text": text, "author": {"id": str(post_id + 1000), "userName": handle or f"user{post_id}"}}


def test_three_personas_and_boundaries():
    cases = [
        ("My dog turns five today. Five years of stealing my spot on the sofa.", "pet_owner"),
        ("My cat fell asleep on my hoodie again.", "pet_owner"),
        ("Finally arranged my new sofa corner with our family photos.", "home_decorator"),
        ("Ten years together. This photo from our first trip still makes me smile.", "relationship_memory"),
        ("We make new memories on every anniversary. This photo from our first trip still makes me smile.", "relationship_memory"),
        ("Finally arranged our collection of family photos on my new living room wall.", "home_decorator"),
        ("Happy birthday Mum!", None),
        ("Cute cat!", None),
        ("Our shop makes custom dog pillow covers. Order now.", None),
        ("Tour this beautifully staged living room. Book a viewing.", None),
        ("I want to be famous. I love anime merch.", None),
    ]
    for text, persona in cases:
        intent = assess_consumer_profile(text)
        assert intent["persona"] == persona, text
        assert intent["shopping_intent"] == "unknown", text
        assert intent["contact_permission"] is False
    assert assess_consumer_profile(cases[2][0], author_bio="Graphic designer, coffee enthusiast")["persona"] == "home_decorator"
    assert assess_consumer_profile(cases[0][0], is_repost=True)["persona"] is None
    keys = assess_consumer_profile("My cat fell asleep on my hoodie again. I'm looking for my keys.")
    assert keys["shopping_intent"] == "unknown"
    assert keys["specific_other_product"] is False
    assert assess_consumer_profile("My cat's photo on a custom face towel made me smile.")["product_fit"] == "verified"


def test_reviewed_life_scene_edges_keep_persona_separate_from_contact_draft():
    accepted = [
        ("Throwback when my son dressed up and was petting our cat.", "pet_owner"),
        ("Almost overslept for work today and my cat just let me.", "pet_owner"),
        ("Here are some cat photos. This solo photo is of our cat Aiya.", "pet_owner"),
        ("If I got this framed and put it on my room wall with my other posters.", "home_decorator"),
    ]
    for post, persona in accepted:
        result = assess_consumer_profile(post)
        assert result["persona"] == persona, post
        assert result["shopping_intent"] == "unknown"
        assert result["product_fit"] != "verified"
    rejected = [
        ("I arranged a DNA test. I walked into my house.", ""),
        ("It is our dog, the owner says. WHAT SHOULD YOU DO? Rabies spreads through bites.", ""),
        ("Immortalis Book 1, Act II, Scene I. Our cat fell asleep on my bed again.", ""),
        ("Our family photo from my wedding still makes me smile.", "The stories here are fictional."),
    ]
    for post, bio in rejected:
        assert assess_consumer_profile(post, author_bio=bio)["persona"] is None, post
    sensitive = assess_consumer_profile("My cat just did something sweet while I was in severe pain.")
    assert sensitive["persona"] == "pet_owner"
    assert sensitive["needs_context_review"] is True
    assert sensitive["shopping_intent"] == "unknown"
    assert assess_consumer_profile("@friend Same shit again my dog 😂")['persona'] is None
    ill_pet = assess_consumer_profile("my dog just needs to make it to her birthday in exactly one week PLEASE no more bad days MAISY HOLD ON")
    assert ill_pet['persona'] == 'pet_owner'
    assert ill_pet['needs_context_review'] is True
    memorial = assess_consumer_profile("We always watch her videos. Our hearts are broken. We even named our cat Chunky Bella in honour of Fiona. RIP sweet girl.")
    assert memorial['persona'] == 'pet_owner'
    assert memorial['needs_context_review'] is True
    future = assess_consumer_profile("I want to take a photo at my wedding with close family.")
    assert future["persona"] == "relationship_memory"
    assert future["experience_phase"] == "future_planned"
    assert future["conversation_angle"] == "a future family occasion they are planning"


def test_pet_self_report_without_fixed_scene_verbs_and_context_guards():
    for text in (
        "My cat got crazy big eyes today.",
        "Here's my cat, I hope you like her.",
        "He's playing with my cat Xixi.",
        "Good morning from my cat friend Lulu.",
        "Why does my dog insist on staying out in the rain?",
        "My partner asked me to draw our dog.",
        "Our dog loves tuna too.",
    ):
        result = assess_consumer_profile(text)
        assert result["persona"] == "pet_owner", text
        assert result["shopping_intent"] == "unknown", text
        assert result["contact_permission"] is False
    for text in (
        "@friend Same shit again my dog 😂",
        '"My dog is a wolf killer!" Sure, but that is a bad guardian dog.',
        "Even if somebody burned our house and shot our dog, this is hypothetical.",
        "Our cat is on our Cat B rookie list.",
        "I posted a collection of my dog portraits; will you do one for free?",
        "We love our $CATE and our cat(e) loves us.",
        "I dreamt my dog turned into an ostrich.",
        "My dog had better hygiene than these dirty people.",
    ):
        assert assess_consumer_profile(text)["persona"] is None, text
    assert assess_consumer_profile("Our cat sleeps beside me. I also follow crypto.")["persona"] == "pet_owner"
    assert assess_consumer_profile("Second solo photo is of our cat Aiya.")["persona"] == "pet_owner"
    for text in (
        "My cat Misho and I are still alive.",
        "We put our dog to sleep today.",
        "My dog needs regular jabs.",
    ):
        result = assess_consumer_profile(text)
        assert result["persona"] == "pet_owner", text
        assert result["needs_context_review"] is True, text
    uncertain = assess_consumer_profile("I lost my cat. Please contact me if you see him at the game.")
    assert uncertain["persona"] == "pet_owner"
    assert uncertain["person_fit"] == "uncertain_self_report"
    assert uncertain["needs_context_review"] is True
    seller_bio = "An organic tannery producing washable rugs."
    assert assess_consumer_profile("I miss my cat who passed away.", author_bio=seller_bio)["persona"] is None


def test_six_distinct_pages_archive_and_contacted_exclusion(tmp_path):
    calls = []
    def handler(request):
        if request.url.path.endswith("/oapi/my/info"):
            return httpx.Response(200, json={"total_bonus_credits": 10000})
        calls.append(request.url.params["query"])
        number = len(calls)
        text = "My dog turns five today. Five years of stealing my spot on the sofa."
        post = _post(number, text)
        if number == 3:
            post["retweetedTweet"] = {"id": "900"}
        return httpx.Response(200, json={"tweets": [post], "has_next_page": True,
                                          "next_cursor": "would-cost-an-extra-page"})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await run_consumer_recall_probe(client, Settings(twitterapi_api_key="test"),
                                                   contacted_snapshot={**SNAPSHOT, "handles": ["user2"]},
                                                   archive_dir=tmp_path, now=NOW)

    summary = asyncio.run(run())
    assert len(calls) == 6
    assert [name for name, _ in QUERY_TIERS] == ["pet_owner_1", "home_decorator_1",
        "relationship_memory_1", "pet_owner_2", "home_decorator_2", "relationship_memory_2"]
    assert summary["retrieved_new_posts"] == 6
    assert summary["contacted_excluded"] == 1
    assert summary["persona_unique_authors"]["pet_owner"] == 4
    assert summary["strict_qualified"] == 0
    archive = tmp_path / f'{summary["archive_id"]}.json'
    document = json.loads(archive.read_text(encoding="utf-8"))
    assert all(len(q["pages"]) == 1 for q in document["queries"])
    rows = extract_raw_reviews([archive])
    assert len(rows) == 6
    assert next(row for row in rows if row["handle"] == "user2")["classifierTier"] == "excluded"
    assert next(row for row in rows if row["handle"] == "user3")["classifierTier"] == "excluded"
    assert all(row["classifierVersion"] == "consumer-life-scenes-v2.2" for row in rows)


def test_old_consumer_archive_is_reassessed_without_changing_source_or_prior_snapshot(tmp_path):
    source = tmp_path / "old.json"
    post = _post(1, "My cat fell asleep on my hoodie again.")
    source.write_text(json.dumps({"kind": "query_only_consumer_recall", "queries": [{
        "name": "gift_giver_1", "pages": [{"response": {"tweets": [post]}}],
        "decisions": [{"post_id": "1", "intent": {"version": "consumer-personas-v1.1",
            "tier": "excluded", "persona": None, "contact_status": "not_seen_in_snapshot"}}],
    }]}), encoding="utf-8")
    destination = tmp_path / "reclass.json"
    result = reclassify_archive(source, destination)
    row = result["rows"][0]
    assert row["source_archive"] == "old.json"
    assert row["source_stage"] == "gift_giver_1"
    assert row["prior_intent"]["tier"] == "excluded"
    assert row["new_intent"]["persona"] == "pet_owner"
    assert row["new_intent"]["previous_classification"]["version"] == "consumer-personas-v1.1"


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
