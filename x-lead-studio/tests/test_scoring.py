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
        "occasion_confidence": 90,
        "ownership_confidence": 90,
        "us_confidence": 90,
        "sensitive": False,
        "advertisement": False,
        "person_primary": False,
        "minor_primary": False,
    }
    score = score_lead(analysis)
    assert score == 89
    assert is_eligible(analysis, score)


def test_manual_text_evidence_does_not_reduce_score_or_block_review():
    analysis = {
        "has_pet": True,
        "pet_confidence": 100,
        "print_fit": 100,
        "clarity": 100,
        "engagement_quality": 100,
        "recency_score": 100,
        "account_quality": 100,
        "occasion_confidence": 0,
        "ownership_confidence": 0,
        "us_confidence": 100,
    }
    score = score_lead(analysis)
    assert score == 100
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
        "occasion_confidence": 100,
        "ownership_confidence": 100,
        "us_confidence": 100,
        "minor_primary": True,
    }
    assert not is_eligible(analysis, score_lead(analysis))


def test_unknown_location_cannot_enter_review():
    analysis = {
        "has_pet": True,
        "pet_confidence": 100,
        "print_fit": 100,
        "clarity": 100,
        "engagement_quality": 100,
        "recency_score": 100,
        "account_quality": 100,
        "occasion_confidence": 100,
        "ownership_confidence": 100,
        "us_confidence": 0,
    }
    assert not is_eligible(analysis, score_lead(analysis))
