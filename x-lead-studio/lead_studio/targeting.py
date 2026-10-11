from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True)
class SearchSegment:
    key: str
    label: str
    query: str


SEARCH_SEGMENTS = (
    SearchSegment(
        key="new_adoption",
        label="New adoption / gotcha day",
        query=(
            '("gotcha day" OR "adopted today" OR "we adopted" OR "I adopted" '
            'OR "welcome home" OR "foster fail" OR "new family member") '
            '(dog OR puppy OR cat OR kitten OR pup OR kitty) filter:images -filter:replies lang:en'
        ),
    ),
    SearchSegment(
        key="pet_birthday",
        label="Pet birthday",
        query=(
            '("happy birthday" OR "birthday boy" OR "birthday girl" OR barkday '
            'OR "birthday pup" OR "birthday kitty" OR "turns one" OR "turned one") '
            '(dog OR puppy OR cat OR kitten OR pup OR kitty) filter:images -filter:replies lang:en'
        ),
    ),
)

US_STATE_NAMES = {
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut",
    "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa",
    "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan",
    "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada",
    "new hampshire", "new jersey", "new mexico", "new york", "north carolina",
    "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island",
    "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia",
    "washington", "west virginia", "wisconsin", "wyoming", "district of columbia",
}
US_STATE_CODES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
    "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
    "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
    "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
}
US_CITIES = {
    "new york city", "los angeles", "chicago", "houston", "phoenix", "philadelphia",
    "san antonio", "san diego", "dallas", "austin", "seattle", "boston", "miami", "denver",
    "atlanta", "portland", "nashville", "las vegas", "detroit", "minneapolis", "tampa",
    "orlando", "charlotte", "raleigh", "new orleans", "salt lake city", "san francisco",
    "washington dc", "washington, dc",
}
NON_US_COUNTRY_TERMS = {
    "canada", "united kingdom", "england", "scotland", "wales", "ireland", "australia",
    "new zealand", "mexico", "france", "germany", "italy", "spain", "india", "singapore",
    "philippines", "south africa",
}
ADOPTION_TERMS = (
    "gotcha day", "adoption anniversary", "adopted today", "we adopted", "i adopted",
    "just adopted", "welcome home", "foster fail", "new family member", "meet our", "meet my",
)
BIRTHDAY_TERMS = (
    "happy birthday", "birthday boy", "birthday girl", "barkday", "birthday pup",
    "birthday kitty", "turns one", "turned one", "first birthday", "1st birthday",
)
OWNERSHIP_PATTERNS = (
    r"\b(?:my|our)\s+(?:dog|cat|puppy|kitten|pup|kitty|pet)\b",
    r"\b(?:we|i)\s+(?:just\s+)?adopted\b",
    r"\bmeet\s+(?:my|our)\b",
    r"\bwelcome\s+home\b",
)
ORGANIZATION_TERMS = (
    "animal shelter", "rescue organization", "rescue centre", "rescue center", "adoption center",
    "adoption centre", "nonprofit", "non-profit", "official account", "pet store", "pet shop",
    "dog breeder", "cat breeder", "kennel", "veterinary clinic", "animal hospital",
    "pet photographer",
)
PROMOTION_TERMS = (
    "#ad", "sponsored", "shop now", "use code", "discount code", "limited offer", "on sale",
    "available for adoption", "apply to adopt",
)


def build_targeting(tweet: dict[str, Any], source_segment: str) -> dict[str, Any]:
    user = tweet.get("user") or tweet.get("author") or {}
    text = str(tweet.get("rawContent") or tweet.get("text") or tweet.get("full_text") or "")
    bio = str(user.get("rawDescription") or user.get("description") or "")
    location = str(user.get("location") or "")
    occasion, occasion_confidence, occasion_terms = detect_occasion(text, source_segment)
    ownership_confidence = detect_ownership(text)
    us_confidence, us_evidence = detect_us_evidence(tweet, location)
    posted_at = str(tweet.get("date") or tweet.get("created_at") or "") or None
    like_count = safe_int(tweet.get("likeCount") or tweet.get("favorite_count"))
    reply_count = safe_int(tweet.get("replyCount") or tweet.get("reply_count"))
    repost_count = safe_int(tweet.get("retweetCount") or tweet.get("retweet_count"))
    view_count = safe_int(tweet.get("viewCount") or tweet.get("view_count"))
    followers_count = safe_int(user.get("followersCount") or user.get("followers_count"))
    result = {
        "segment": source_segment,
        "occasion": occasion,
        "occasion_confidence": occasion_confidence,
        "ownership_confidence": ownership_confidence,
        "us_confidence": us_confidence,
        "us_evidence": us_evidence,
        "organization": contains_any(bio, ORGANIZATION_TERMS),
        "advertisement": contains_any(text, PROMOTION_TERMS),
        "matched_terms": occasion_terms,
        "like_count": like_count,
        "reply_count": reply_count,
        "repost_count": repost_count,
        "view_count": view_count,
        "followers_count": followers_count,
        "engagement_quality": engagement_quality(like_count, reply_count, repost_count, view_count),
        "account_quality": account_quality(user, followers_count),
        "recency_score": recency_score(posted_at),
    }
    result["lead_score"] = targeting_score(result)
    return result


def detect_occasion(text: str, source_segment: str = "custom") -> tuple[str, int, list[str]]:
    lowered = text.casefold()
    adoption_matches = [term for term in ADOPTION_TERMS if term in lowered]
    birthday_matches = [term for term in BIRTHDAY_TERMS if term in lowered]
    if adoption_matches and len(adoption_matches) >= len(birthday_matches):
        return "new_adoption", min(100, 82 + 6 * len(adoption_matches)), adoption_matches
    if birthday_matches:
        return "pet_birthday", min(100, 82 + 6 * len(birthday_matches)), birthday_matches
    if source_segment in {"new_adoption", "pet_birthday"}:
        return source_segment, 35, []
    return "unknown", 0, []


def detect_ownership(text: str) -> int:
    lowered = text.casefold()
    matches = sum(bool(re.search(pattern, lowered)) for pattern in OWNERSHIP_PATTERNS)
    if matches >= 2:
        return 100
    if matches == 1:
        return 88
    if any(term in lowered for term in ADOPTION_TERMS + BIRTHDAY_TERMS):
        return 55
    return 0


def detect_us_evidence(tweet: dict[str, Any], profile_location: str) -> tuple[int, str]:
    place = tweet.get("place") or {}
    country_code = str(place.get("countryCode") or place.get("country_code") or "").upper()
    country = str(place.get("country") or "").casefold()
    if country_code:
        return (100, "post_place_country:US") if country_code == "US" else (0, f"post_place_country:{country_code}")
    if country:
        if country in {"united states", "united states of america", "usa"}:
            return 100, "post_place_country:US"
        return 0, f"post_place_country:{country[:40]}"
    raw = profile_location.strip()
    lowered = raw.casefold()
    if not lowered:
        return 0, "no_public_location"
    if any(term in lowered for term in NON_US_COUNTRY_TERMS):
        return 0, "profile_location_non_us"
    if re.search(r"\b(?:usa|u\.s\.a\.|united states|united states of america)\b", lowered):
        return 92, "profile_location_country:US"
    if any(re.search(rf"\b{re.escape(state)}\b", lowered) for state in US_STATE_NAMES):
        return 86, "profile_location_state"
    code_match = re.search(r",\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$", raw)
    if code_match and code_match.group(1).upper() in US_STATE_CODES:
        return 86, f"profile_location_state:{code_match.group(1).upper()}"
    if lowered in US_CITIES:
        return 74, "profile_location_us_city"
    return 25, "profile_location_unresolved"


def candidate_status(targeting: dict[str, Any], us_required: bool, us_min_confidence: int) -> str:
    if targeting.get("organization") or targeting.get("advertisement"):
        return "rejected_targeting"
    if us_required and int(targeting.get("us_confidence", 0)) < us_min_confidence:
        return "location_review"
    if int(targeting.get("occasion_confidence", 0)) < 60 or int(targeting.get("ownership_confidence", 0)) < 60:
        return "targeting_review"
    return "new"


def targeting_score(targeting: dict[str, Any]) -> int:
    weighted = (
        int(targeting.get("occasion_confidence", 0)) * 0.25
        + int(targeting.get("ownership_confidence", 0)) * 0.25
        + int(targeting.get("us_confidence", 0)) * 0.20
        + int(targeting.get("engagement_quality", 0)) * 0.15
        + int(targeting.get("account_quality", 0)) * 0.10
        + int(targeting.get("recency_score", 0)) * 0.05
    )
    return max(0, min(100, round(weighted)))


def engagement_quality(likes: int, replies: int, reposts: int, views: int) -> int:
    weighted = max(0, likes) + max(0, replies) * 2 + max(0, reposts) * 3
    rate_score = min(35, round((weighted / views) * 700)) if views > 0 else 0
    volume_score = min(65, round(math.log10(weighted + 1) * 32))
    return min(100, 20 + volume_score + rate_score)


def account_quality(user: dict[str, Any], followers: int) -> int:
    score = 35
    for threshold in (25, 100, 500):
        if followers >= threshold:
            score += 10
    if str(user.get("rawDescription") or user.get("description") or "").strip():
        score += 10
    if user.get("verified") or user.get("blue"):
        score += 10
    return min(100, score)


def recency_score(posted_at: str | None) -> int:
    if not posted_at:
        return 40
    try:
        parsed = datetime.fromisoformat(posted_at.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        age_days = max(0, int((datetime.now(timezone.utc) - parsed).total_seconds() / 86400))
    except ValueError:
        return 40
    return max(0, 100 - age_days * 4)


def safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def contains_any(value: str, terms: tuple[str, ...]) -> bool:
    lowered = value.casefold()
    return any(term in lowered for term in terms)

