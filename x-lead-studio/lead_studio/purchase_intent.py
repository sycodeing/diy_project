"""Conservative, explainable conversation signals; never purchase probabilities."""
from __future__ import annotations

import re
from typing import Any

DEMAND_SEGMENT_KEYS = ("demand_custom", "demand_recommendation", "demand_decor")
VERSION = "pet-demand-v1"
PRODUCT = r"\b(?:pillow(?:case|\s+cover)?s?|cushions?|portraits?|prints?|wall\s+art|keepsakes?)\b"
PET = r"\b(?:dog|cat|puppy|kitten|pet)s?\b"
CUSTOM_CONTEXT = r"\b(?:portraits?|photos?|pictures?|custom|personalized|personalised)\b"
REQUEST = r"\b(?:where\s+can\s+i|where\s+to\s+(?:buy|order)|any(?:one|body)\s+(?:know|recommend)|looking\s+for|i(?:'m|\s+am)\s+looking|recommendations?\s+for|i\s+(?:want|need|would\s+like)\s+to\s+(?:buy|order|commission)|want\s+to\s+get)\b"
WISH = r"\b(?:i\s+(?:want|wish|would\s+love)|would\s+look\s+(?:great|good)|thinking\s+(?:of|about)|decorating)\b"
EXCLUSIONS = {
    "sensitive_context": r"\b(?:passed\s+away|died|rainbow\s+bridge|cancer|tumou?r|surgery|gofundme|fundrais\w*|missing\s+(?:dog|cat)|lost\s+my\s+(?:dog|cat))\b",
    "seller_or_giveaway": r"\b(?:shop\s+now|for\s+sale|use\s+(?:my\s+)?code|commissions?\s+open|giveaway|affiliate|dm\s+(?:me\s+)?to\s+order|i\s+(?:sell|make)|my\s+shop)\b",
    "already_purchased": r"\b(?:already\s+(?:bought|ordered)|just\s+(?:bought|ordered|received)|i\s+(?:bought|ordered)|arrived\s+today)\b",
    "urgent_delivery": r"\b(?:tomorrow|tonight|this\s+weekend|next\s+week|overnight|urgent|asap|by\s+friday|in\s+[1-9]\s+days?)\b",
    "negative_or_hypothetical": r"\b(?:don'?t\s+(?:want|need)|do\s+not\s+(?:want|need)|not\s+(?:looking|interested)|can'?t\s+afford|cannot\s+afford|if\s+i|joking|just\s+kidding)\b",
}


def assess_purchase_intent(text: str) -> dict[str, Any]:
    text = text.replace("’", "'")
    result: dict[str, Any] = {
        "version": VERSION, "tier": "excluded", "score": 0,
        "evidence": [], "exclusion_reasons": [],
        "human_review_required": True, "contact_permission": False,
    }
    for reason, pattern in EXCLUSIONS.items():
        match = re.search(pattern, text, re.I)
        if match:
            result["exclusion_reasons"].append(reason)
            result["evidence"].append(match.group(0))
    if result["exclusion_reasons"]:
        return result
    # The pet, relevant product and buyer language must occur in one short
    # sentence, not merely somewhere in the bio or unrelated post paragraphs.
    for sentence in re.split(r"[.!?\n]+", text):
        if (len(sentence) > 350 or not re.search(PET, sentence, re.I)
                or not re.search(PRODUCT, sentence, re.I) or not re.search(CUSTOM_CONTEXT, sentence, re.I)):
            continue
        tier, score = ("explicit_request", 80) if re.search(REQUEST, sentence, re.I) else (
            ("exploratory", 50) if re.search(WISH, sentence, re.I) else ("excluded", 0)
        )
        if score > result["score"]:
            result.update(tier=tier, score=score, evidence=[sentence.strip()])
    if not result["score"]:
        result["exclusion_reasons"] = ["no_current_product_request"]
    return result
