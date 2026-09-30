from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def score_lead(analysis: dict[str, Any], posted_at: str | None = None) -> int:
    pet = round(max(0, min(100, int(analysis.get("pet_confidence", 0)))) * 0.30)
    composition = round(max(0, min(100, int(analysis.get("print_fit", 0)))) * 0.20)
    engagement = round(max(0, min(100, int(analysis.get("engagement_quality", 50)))) * 0.20)
    account = round(max(0, min(100, int(analysis.get("account_quality", 50)))) * 0.15)
    recency = int(analysis.get("recency_score", _recency(posted_at)))
    return min(100, pet + composition + engagement + account + round(max(0, min(100, recency)) * 0.15))


def is_eligible(analysis: dict[str, Any], score: int, threshold: int = 70) -> bool:
    return bool(
        analysis.get("has_pet")
        and not analysis.get("sensitive")
        and not analysis.get("advertisement")
        and not analysis.get("person_primary")
        and not analysis.get("minor_primary")
        and int(analysis.get("clarity", 0)) >= 50
        and score >= threshold
    )


def _recency(posted_at: str | None) -> int:
    if not posted_at:
        return 50
    try:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(posted_at.replace("Z", "+00:00"))
    except ValueError:
        return 50
    return max(0, 100 - int(age.total_seconds() / 86400) * 3)
