from lead_studio.targeting import SEARCH_SEGMENTS, build_targeting, candidate_status, detect_pet_type, detect_us_evidence


def test_search_queries_cover_broader_owner_phrases_before_strict_targeting():
    queries = {segment.key: segment.query for segment in SEARCH_SEGMENTS}
    assert '"meet my dog"' in queries["new_adoption"]
    assert '"happy birthday to my dog"' in queries["pet_birthday"]
    assert '"beach day with our dog"' in queries["pet_adventure"]
    assert '"my dog christmas outfit"' in queries["pet_costume"]
    assert '"look at our dog"' in queries["pet_portrait"]


def tweet(**overrides):
    value = {
        "rawContent": "We adopted our new puppy today. Welcome home, Maple!",
        "date": "2026-10-09T12:00:00+00:00",
        "likeCount": 18,
        "replyCount": 3,
        "retweetCount": 1,
        "viewCount": 800,
        "place": None,
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
    assert targeting["occasion"] == "new_adoption"
    assert targeting["pet_type"] == "dog"
    assert targeting["ownership_confidence"] >= 88
    assert targeting["us_confidence"] == 86
    assert candidate_status(targeting, True, 70) == "new"


def test_post_place_country_is_strongest_location_evidence():
    confidence, evidence = detect_us_evidence(
        {"place": {"countryCode": "US", "country": "United States"}},
        "Toronto, Canada",
    )
    assert confidence == 100
    assert evidence == "post_place_country:US"


def test_unknown_location_waits_for_manual_review():
    targeting = build_targeting(tweet(user={"username": "maple_home", "location": ""}), "new_adoption")
    assert targeting["us_confidence"] == 0
    assert candidate_status(targeting, True, 70) == "location_review"


def test_account_origin_can_confirm_us_when_profile_location_is_ambiguous():
    targeting = build_targeting(
        tweet(user={"username": "maple_home", "location": "Earth", "accountBasedIn": "United States"}),
        "new_adoption",
    )
    assert targeting["us_confidence"] == 88
    assert targeting["us_evidence"] == "account_based_in:US"
    assert candidate_status(targeting, True, 70) == "new"


def test_explicit_non_us_account_origin_is_rejected():
    targeting = build_targeting(
        tweet(user={"username": "maple_home", "location": "", "accountBasedIn": "Turkey"}),
        "new_adoption",
    )
    assert targeting["us_evidence"] == "account_based_in_non_us:Turkey"
    assert candidate_status(targeting, True, 70) == "rejected_targeting"


def test_ambiguous_account_origin_region_remains_location_review():
    targeting = build_targeting(
        tweet(user={"username": "maple_home", "location": "", "accountBasedIn": "North America"}),
        "new_adoption",
    )
    assert targeting["us_confidence"] == 25
    assert targeting["us_evidence"] == "account_based_in_region_ambiguous:North America"
    assert candidate_status(targeting, True, 70) == "location_review"


def test_inaccurate_account_origin_remains_location_review():
    targeting = build_targeting(
        tweet(user={
            "username": "maple_home",
            "location": "",
            "accountBasedIn": "United States",
            "accountBasedInAccurate": False,
        }),
        "new_adoption",
    )
    assert targeting["us_confidence"] == 65
    assert targeting["us_evidence"] == "account_based_in_us_unverified"
    assert candidate_status(targeting, True, 70) == "location_review"


def test_business_account_is_rejected_before_image_analysis():
    targeting = build_targeting(
        tweet(user={
            "username": "happy_paws",
            "rawDescription": "Official account of an animal shelter and adoption center",
            "location": "Denver, CO",
            "followersCount": 5000,
        }),
        "new_adoption",
    )
    assert targeting["organization"] is True
    assert candidate_status(targeting, True, 70) == "rejected_targeting"


def test_weak_ownership_and_scene_evidence_wait_for_targeting_review():
    targeting = build_targeting(
        tweet(rawContent="A wonderful dog photo", user={
            "username": "dog_photo",
            "rawDescription": "Dog parent",
            "location": "Austin, TX",
        }),
        "pet_birthday",
    )
    assert targeting["ownership_confidence"] == 0
    assert targeting["occasion_confidence"] == 35
    assert candidate_status(targeting, True, 70) == "targeting_review"


def test_expanded_pet_scenes_are_detected_with_owner_evidence():
    cases = [
        ("pet_adventure", "Hiking with my dog was the best part of the weekend", "dog"),
        ("pet_costume", "My cat dressed up for Halloween", "cat"),
        ("pet_portrait", "This is my favorite photo of my dog", "dog"),
    ]

    for segment, text, pet_type in cases:
        targeting = build_targeting(tweet(
            rawContent=text,
            user={"username": "pet_owner", "rawDescription": "Proud pet parent", "location": "Austin, TX"},
        ), segment)
        assert targeting["occasion"] == segment
        assert targeting["occasion_confidence"] >= 82
        assert targeting["ownership_confidence"] >= 88
        assert targeting["pet_type"] == pet_type
        assert candidate_status(targeting, True, 70) == "new"


def test_existing_queries_now_produce_strong_scene_evidence():
    adoption = build_targeting(tweet(rawContent="Our new puppy is finally home"), "new_adoption")
    birthday = build_targeting(tweet(rawContent="It is my dog's birthday today"), "pet_birthday")

    assert adoption["occasion_confidence"] >= 82
    assert birthday["occasion_confidence"] >= 82


def test_targeting_keeps_matching_phrases_as_review_evidence():
    targeting = build_targeting(tweet(), "new_adoption")
    assert "we adopted" in [term.casefold() for term in targeting["ownership_terms"]]
    assert "welcome home" in [term.casefold() for term in targeting["matched_terms"]]


def test_first_phase_only_accepts_unambiguous_cats_or_dogs():
    assert detect_pet_type("Our kitten turns one today") == "cat"
    assert detect_pet_type("Welcome home to our new puppy") == "dog"
    assert detect_pet_type("Our rabbit joined the family") is None
    assert detect_pet_type("Our cat and dog are best friends") is None


def test_promotional_pet_posts_are_rejected_with_review_evidence():
    targeting = build_targeting(
        tweet(rawContent="My cat's birthday book is now available on Amazon. Follow us for more!"),
        "pet_birthday",
    )

    assert targeting["advertisement"] is True
    assert "now available on amazon" in targeting["promotion_terms"]
    assert "follow us" in targeting["promotion_terms"]
    assert candidate_status(targeting, True, 70) == "rejected_targeting"
