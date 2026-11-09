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
            '(("gotcha day" OR "just adopted" OR "new puppy" OR "new kitten" '
            'OR "meet my" OR "meet our" OR "welcome home" OR "foster fail") '
            '(dog OR puppy OR cat OR kitten OR pup OR kitty)) '
            'filter:images -filter:replies lang:en'
        ),
    ),
    SearchSegment(
        key="pet_birthday",
        label="Pet birthday",
        query=(
            '((birthday OR "birthday boy" OR "birthday girl" OR barkday '
            'OR "turns one" OR "turned one") '
            '("my dog" OR "my cat" OR "our dog" OR "our cat" OR puppy OR kitten OR pup OR kitty)) '
            'filter:images -filter:replies lang:en'
        ),
    ),
    SearchSegment(
        key="pet_adventure",
        label="Pet adventure / outdoors",
        query=(
            '((hiking OR beach OR camping OR "road trip" OR adventure) '
            '("my dog" OR "my cat" OR "our dog" OR "our cat")) '
            'filter:images -filter:replies lang:en'
        ),
    ),
    SearchSegment(
        key="pet_costume",
        label="Pet costume / holiday outfit",
        query=(
            '((costume OR "dressed up" OR "holiday outfit" OR "christmas outfit") '
            '("my dog" OR "my cat" OR "our dog" OR "our cat")) '
            'filter:images -filter:replies lang:en'
        ),
    ),
    SearchSegment(
        key="pet_portrait",
        label="Pet portrait / proud moment",
        query=(
            '(("favorite photo" OR "best photo" OR photogenic OR "look at") '
            '("my dog" OR "my cat" OR "our dog" OR "our cat")) '
            'filter:images -filter:replies lang:en'
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
    "my new dog", "my new cat", "my new puppy", "my new kitten", "our new dog",
    "our new cat", "our new puppy", "our new kitten",
)
BIRTHDAY_TERMS = (
    "happy birthday", "birthday boy", "birthday girl", "barkday", "birthday pup",
    "birthday kitty", "turns one", "turned one", "first birthday", "1st birthday",
    "my dog's birthday", "my dog birthday", "my cat's birthday", "my cat birthday",
    "our dog's birthday", "our dog birthday", "our cat's birthday", "our cat birthday",
)
ADVENTURE_TERMS = (
    "hiking with my", "hiking with our", "beach day with my", "beach day with our",
    "road trip with my", "road trip with our", "camping with my", "camping with our",
    "adventure with my", "adventure with our",
)
COSTUME_TERMS = (
    "in costume", "dressed up", "halloween costume", "holiday outfit", "christmas outfit",
)
PORTRAIT_TERMS = (
    "favorite photo of my", "favorite photo of our", "best photo of my", "best photo of our",
    "my handsome", "our handsome", "my beautiful", "our beautiful", "my photogenic",
    "our photogenic", "look at my", "look at our",
)
SCENE_TERMS = {
    "new_adoption": ADOPTION_TERMS,
    "pet_birthday": BIRTHDAY_TERMS,
    "pet_adventure": ADVENTURE_TERMS,
    "pet_costume": COSTUME_TERMS,
    "pet_portrait": PORTRAIT_TERMS,
}
MIN_OWNERSHIP_CONFIDENCE = 70
MIN_SCENE_CONFIDENCE = 70
OWNERSHIP_PATTERNS = (
    r"\b(?:my|our)\s+(?:(?:new|beautiful|handsome|sweet|little|old)\s+){0,2}(?:dog|cat|puppy|kitten|pup|kitty|pet)\b",
    r"\b(?:we|i)\s+(?:just\s+)?adopted\b",
    r"\bi\s+(?:literally\s+)?(?:just\s+)?(?:acquired|brought\s+home)\s+(?:a|an)\s+(?:new\s+)?(?:dog|cat|puppy|kitten)\b",
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
    "available for adoption", "apply to adopt", "link in bio", "follow us", "follow for more",
    "subscribe", "now available on amazon", "live on amazon", "amazon bestseller",
    "pre-order now", "preorder now",
)
DOG_TERMS = ("dog", "puppy", "pup", "doggo", "canine")
CAT_TERMS = ("cat", "kitten", "kitty", "feline")


def build_targeting(tweet: dict[str, Any], source_segment: str) -> dict[str, Any]:
    user = tweet.get("user") or tweet.get("author") or {}
    text = str(tweet.get("rawContent") or tweet.get("text") or tweet.get("full_text") or "")
    bio = str(user.get("rawDescription") or user.get("description") or "")
    location = str(user.get("location") or "")
    occasion, occasion_confidence, occasion_terms = detect_occasion(text, source_segment)
    # A pet mentioned only in the account bio does not describe this post.
    pet_type = detect_pet_type(text)
    ownership_terms = detect_ownership_evidence(text)
    ownership_confidence = ownership_score(ownership_terms, text)
    organization = contains_any(bio, ORGANIZATION_TERMS)
    promotion_terms = matching_terms(text, PROMOTION_TERMS)
    advertisement = bool(promotion_terms)
    us_confidence, us_evidence = detect_us_evidence(tweet, location)
    posted_at = str(tweet.get("date") or tweet.get("created_at") or "") or None
    like_count = safe_int(tweet.get("likeCount") or tweet.get("favorite_count"))
    reply_count = safe_int(tweet.get("replyCount") or tweet.get("reply_count"))
    repost_count = safe_int(tweet.get("retweetCount") or tweet.get("retweet_count"))
    view_count = safe_int(tweet.get("viewCount") or tweet.get("view_count"))
    followers_count = safe_int(user.get("followersCount") or user.get("followers_count"))
    return {
        "segment": source_segment,
        "occasion": occasion,
        "pet_type": pet_type,
        "occasion_confidence": occasion_confidence,
        "ownership_confidence": ownership_confidence,
        "us_confidence": us_confidence,
        "us_evidence": us_evidence,
        "organization": organization,
        "advertisement": advertisement,
        "promotion_terms": promotion_terms,
        "matched_terms": occasion_terms,
        "ownership_terms": ownership_terms,
        "like_count": like_count,
        "reply_count": reply_count,
        "repost_count": repost_count,
        "view_count": view_count,
        "followers_count": followers_count,
        "engagement_quality": engagement_quality(like_count, reply_count, repost_count, view_count),
        "account_quality": account_quality(user, followers_count),
        "recency_score": recency_score(posted_at),
    }


def detect_occasion(text: str, source_segment: str = "custom") -> tuple[str, int, list[str]]:
    lowered = text.casefold()
    matches_by_scene = {
        scene: [term for term in terms if term in lowered]
        for scene, terms in SCENE_TERMS.items()
    }
    matched_scenes = [
        (scene, matches)
        for scene, matches in matches_by_scene.items()
        if matches
    ]
    if matched_scenes:
        scene, matches = max(
            matched_scenes,
            key=lambda item: (len(item[1]), item[0] == source_segment),
        )
        return scene, min(100, 82 + 6 * len(matches)), matches
    if source_segment in SCENE_TERMS:
        return source_segment, 35, []
    return "unknown", 0, []


def detect_ownership(text: str) -> int:
    return ownership_score(detect_ownership_evidence(text), text)


def detect_ownership_evidence(text: str) -> list[str]:
    evidence: list[str] = []
    for pattern in OWNERSHIP_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match and match.group(0).casefold() not in {item.casefold() for item in evidence}:
            evidence.append(match.group(0))
    return evidence


def ownership_score(evidence: list[str], text: str) -> int:
    if len(evidence) >= 2:
        return 100
    if len(evidence) == 1:
        return 88
    lowered = text.casefold()
    if any(term in lowered for term in ADOPTION_TERMS + BIRTHDAY_TERMS):
        return 55
    return 0


def detect_pet_type(text: str) -> str | None:
    lowered = text.casefold()
    dog_matches = sum(bool(re.search(rf"\b{re.escape(term)}s?\b", lowered)) for term in DOG_TERMS)
    cat_matches = sum(bool(re.search(rf"\b{re.escape(term)}s?\b", lowered)) for term in CAT_TERMS)
    if dog_matches and not cat_matches:
        return "dog"
    if cat_matches and not dog_matches:
        return "cat"
    return None


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

    source = tweet.get("_source_metadata") or {}
    search_query = str(source.get("search_query") or "")
    if re.search(r"(?:^|\s)place_country:US(?:\s|$)", search_query, re.IGNORECASE):
        return 98, "search_query_place_country:US"

    user = tweet.get("user") or tweet.get("author") or {}
    account_based_in = str(user.get("accountBasedIn") or user.get("account_based_in") or "").strip()
    account_based_in_accurate = user.get("accountBasedInAccurate", user.get("account_based_in_accurate"))
    profile_result = _profile_location_evidence(profile_location)
    if account_based_in:
        normalized_origin = account_based_in.casefold()
        origin_us = normalized_origin in {
            "united states", "united states of america", "usa", "us", "u.s.", "u.s.a.",
        }
        origin_is_ambiguous_region = normalized_origin in {"north america"}
        profile_is_us = profile_result[0] >= 70
        profile_is_non_us = profile_result[1] == "profile_location_non_us"
        if account_based_in_accurate is False:
            if origin_us:
                return 65, "account_based_in_us_unverified"
            if origin_is_ambiguous_region:
                return 25, f"account_based_in_region_ambiguous:{account_based_in[:40]}"
            return 0, f"account_based_in_non_us_unverified:{account_based_in[:40]}"
        if origin_us and profile_is_non_us:
            return 25, "location_conflict:profile_non_us_account_us"
        if not origin_us and profile_is_us:
            return 25, "location_conflict:profile_us_account_non_us"
        if origin_us:
            return (96, "profile_and_account_based_in:US") if profile_is_us else (88, "account_based_in:US")
        if origin_is_ambiguous_region:
            return 25, f"account_based_in_region_ambiguous:{account_based_in[:40]}"
        return 0, f"account_based_in_non_us:{account_based_in[:40]}"
    return profile_result


def _profile_location_evidence(profile_location: str) -> tuple[int, str]:

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
    if targeting.get("pet_type") not in {"cat", "dog"}:
        return "rejected_targeting"
    if targeting.get("organization") or targeting.get("advertisement"):
        return "rejected_targeting"
    # A real cat/dog photo still needs evidence it belongs to the posting person.
    if int(targeting.get("ownership_confidence", 0)) < MIN_OWNERSHIP_CONFIDENCE:
        return "rejected_targeting"
    us_evidence = str(targeting.get("us_evidence") or "")
    if us_required and (
        us_evidence == "profile_location_non_us"
        or us_evidence.startswith("post_place_country:") and us_evidence != "post_place_country:US"
        or us_evidence.startswith("account_based_in_non_us")
    ):
        return "rejected_targeting"
    if us_required and int(targeting.get("us_confidence", 0)) < us_min_confidence:
        return "location_review"
    if int(targeting.get("occasion_confidence", 0)) < MIN_SCENE_CONFIDENCE:
        return "targeting_review"
    return "new"


def engagement_quality(likes: int, replies: int, reposts: int, views: int) -> int:
    weighted = max(0, likes) + max(0, replies) * 2 + max(0, reposts) * 3
    if views > 0:
        rate_score = min(35, round((weighted / views) * 700))
    else:
        rate_score = 0
    volume_score = min(65, round(math.log10(weighted + 1) * 32))
    return min(100, 20 + volume_score + rate_score)


def account_quality(user: dict[str, Any], followers: int) -> int:
    score = 35
    if followers >= 25:
        score += 10
    if followers >= 100:
        score += 10
    if followers >= 500:
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
    return bool(matching_terms(value, terms))


def matching_terms(value: str, terms: tuple[str, ...]) -> list[str]:
    lowered = value.casefold()
    return [term for term in terms if term in lowered]
