from lead_studio.app import _candidate_from_tweet, _remote_candidate_payload
from lead_studio.targeting import build_targeting, candidate_status, detect_us_evidence


def tweet(**overrides):
    value = {
        "id": "123456789",
        "rawContent": "We adopted our new puppy today. Welcome home, Maple!",
        "date": "2026-10-09T12:00:00+00:00",
        "likeCount": 18,
        "replyCount": 3,
        "retweetCount": 1,
        "viewCount": 800,
        "place": None,
        "media": {"photos": [{"url": "https://pbs.twimg.com/media/example.jpg"}]},
        "user": {
            "username": "maple_home",
            "rawDescription": "Dog parent and weekend hiker",
            "location": "Austin, TX",
            "followersCount": 240,
        },
    }
    value.update(overrides)
    return value


def test_adoption_owner_with_us_profile_is_ready_for_image_review():
    targeting = build_targeting(tweet(), "new_adoption")
    assert targeting["ownership_confidence"] >= 88
    assert targeting["us_confidence"] == 86
    assert targeting["lead_score"] >= 70
    assert candidate_status(targeting, True, 70) == "new"


def test_post_place_country_is_strongest_location_evidence():
    confidence, evidence = detect_us_evidence(
        {"place": {"countryCode": "US", "country": "United States"}},
        "Toronto, Canada",
    )
    assert confidence == 100
    assert evidence == "post_place_country:US"


def test_unknown_location_waits_for_manual_review():
    value = tweet(user={"username": "maple_home", "location": ""})
    targeting = build_targeting(value, "new_adoption")
    assert candidate_status(targeting, True, 70) == "location_review"


def test_remote_payload_contains_only_normalized_public_fields():
    candidate = _candidate_from_tweet(tweet(), "new_adoption", True, 70)
    assert candidate is not None
    payload = _remote_candidate_payload(candidate)
    assert payload["handle"] == "maple_home"
    assert payload["selectionStatus"] == "new"
    assert payload["postUrl"].endswith("/123456789")
    assert "cookie" not in str(payload).lower()

