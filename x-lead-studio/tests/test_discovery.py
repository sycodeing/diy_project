import json

from lead_studio.discovery import candidate_from_tweet, dedupe_candidates_by_author


def test_dedupe_candidates_by_author_preserves_first_candidate():
    candidates = [
        {"post_id": "1", "author_hash": "a" * 64},
        {"post_id": "2", "author_hash": "a" * 64},
        {"post_id": "3", "author_hash": "b" * 64},
    ]

    assert [item["post_id"] for item in dedupe_candidates_by_author(candidates)] == ["1", "3"]
from lead_studio.x_lead_worker import _cloud_candidate


def test_candidate_discovery_serializes_for_shared_cloud_pool():
    tweet = {
        "id": "190000000000000001",
        "rawContent": "We adopted our new puppy today. Welcome home, Maple!",
        "date": "2026-10-13T12:00:00+00:00",
        "likeCount": 20,
        "replyCount": 3,
        "media": {"photos": [{"url": "https://pbs.twimg.com/media/example.jpg"}]},
        "user": {
            "username": "maple_home",
            "rawDescription": "Dog parent",
            "location": "Austin, TX",
            "followersCount": 240,
        },
    }

    candidate = candidate_from_tweet(
        tweet,
        "new_adoption",
        us_required=True,
        us_min_confidence=70,
    )

    assert candidate is not None
    assert candidate["pet_type"] == "dog"
    assert candidate["status"] == "new"
    cloud = _cloud_candidate(candidate)
    assert cloud["postId"] == tweet["id"]
    assert cloud["handle"] == "maple_home"
    assert cloud["petType"] == "dog"
    assert cloud["selectionStatus"] == "new"
    assert cloud["targetingData"]["pet_type"] == "dog"
    targeting_data = json.loads(candidate["targeting_json"])
    assert targeting_data["organization"] is False
    assert "we adopted" in [term.casefold() for term in targeting_data["ownership_terms"]]
    assert targeting_data["post_excerpt"] == tweet["rawContent"]


def test_candidate_discovery_rejects_ambiguous_pet_type():
    tweet = {
        "id": "190000000000000002",
        "rawContent": "Our cat and dog are celebrating together",
        "media": {"photos": [{"url": "https://pbs.twimg.com/media/example2.jpg"}]},
        "user": {"username": "two_pets", "location": "Denver, CO"},
    }
    candidate = candidate_from_tweet(
        tweet,
        "pet_birthday",
        us_required=True,
        us_min_confidence=70,
    )
    assert candidate is not None
    assert candidate["pet_type"] is None
    assert candidate["status"] == "rejected_targeting"
