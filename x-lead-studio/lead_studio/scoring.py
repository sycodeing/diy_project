from __future__ import annotations

from typing import Any

from .targeting import recency_score


def score_lead(analysis: dict[str, Any], posted_at: str | None = None) -> int:
    values = {
        "pet": (_bounded(analysis.get("pet_confidence")), 0.30),
        "composition": (_bounded(analysis.get("print_fit")), 0.25),
        "us": (_bounded(analysis.get("us_confidence")), 0.15),
        "engagement": (_bounded(analysis.get("engagement_quality", 20)), 0.15),
        "account": (_bounded(analysis.get("account_quality", 35)), 0.075),
        "recency": (_bounded(analysis.get("recency_score", recency_score(posted_at))), 0.075),
    }
    return min(100, sum(round(value * weight) for value, weight in values.values()))


def is_eligible(
    analysis: dict[str, Any],
    score: int,
    threshold: int = 70,
    us_required: bool = True,
    us_min_confidence: int = 70,
) -> bool:
    return bool(
        analysis.get("has_pet")
        and not analysis.get("sensitive")
        and not analysis.get("advertisement")
        and not analysis.get("person_primary")
        and not analysis.get("minor_primary")
        and int(analysis.get("clarity", 0)) >= 50
        and (not us_required or int(analysis.get("us_confidence", 0)) >= us_min_confidence)
        and score >= threshold
    )


def _bounded(value: Any) -> int:
    try:
        return max(0, min(100, int(value or 0)))
    except (TypeError, ValueError):
        return 0
