from lead_studio.scoring import is_eligible, score_lead


def test_qualified_pet_reaches_review_threshold():
    analysis = {
        "has_pet": True,
        "pet_confidence": 95,
        "print_fit": 90,
        "clarity": 85,
        "engagement_quality": 80,
        "recency_score": 90,
        "account_quality": 80,
        "sensitive": False,
        "advertisement": False,
        "person_primary": False,
        "minor_primary": False,
    }
    score = score_lead(analysis)
    assert score == 88
    assert is_eligible(analysis, score)


def test_minor_primary_is_always_excluded():
    analysis = {
        "has_pet": True,
        "pet_confidence": 100,
        "print_fit": 100,
        "clarity": 100,
        "engagement_quality": 100,
        "recency_score": 100,
        "account_quality": 100,
        "minor_primary": True,
    }
    assert not is_eligible(analysis, score_lead(analysis))
