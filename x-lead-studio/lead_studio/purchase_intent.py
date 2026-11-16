"""Conservative, explainable conversation signals; never purchase probabilities."""
from __future__ import annotations

import re
from typing import Any

DEMAND_SEGMENT_KEYS = ("demand_custom", "demand_recommendation", "demand_gift", "demand_decor")
DEMAND_SCENES = ("custom", "gift", "decor")
VERSION = "pet-demand-v2"
PRODUCT = r"\b(?:pillow(?:case|\s+cover)?s?|cushions?|portraits?|prints?|wall\s+art|keepsakes?)\b"
PET = r"\b(?:dog|cat|puppy|kitten|pet)s?\b"
CUSTOM_CONTEXT = r"\b(?:portraits?|photos?|pictures?|custom|personalized|personalised)\b"
REQUEST = r"\b(?:where\s+can\s+i|where\s+to\s+(?:buy|order)|any(?:one|body)\s+(?:know|recommend)|looking\s+for|i(?:'m|\s+am)\s+looking|recommendations?\s+for|i\s+(?:want|need|would\s+like)\s+to\s+(?:buy|order|commission)|want\s+to\s+get)\b"
GIFT = r"\b(?:gifts?|presents?)\b"
DECOR = r"\b(?:decor(?:ating)?|sofa|couch|living\s+room|bedroom|wall\s+art)\b"
GIFT_REQUEST = r"\b(?:gift\s+ideas?|what\s+(?:can|should)\s+i\s+(?:buy|get)|need\s+(?:a\s+)?(?:gift|present))\b"
UNRELATED_GIFT = r"\b(?:toys?|treats?|food|leash(?:es)?|collars?|beds?)\b"
WISH = r"\b(?:i\s+(?:want|wish|would\s+love)|would\s+look\s+(?:great|good)|thinking\s+(?:of|about)|decorating)\b"
EXCLUSIONS = {
    "sensitive_context": r"\b(?:passed\s+away|died|rainbow\s+bridge|cancer|tumou?r|surgery|gofundme|fundrais\w*|missing\s+(?:dog|cat)|lost\s+my\s+(?:dog|cat))\b",
    "seller_or_giveaway": r"\b(?:shop\s+now|for\s+sale|use\s+(?:my\s+)?code|commissions?\s+open|giveaway|affiliate|dm\s+(?:me\s+)?to\s+order|i\s+(?:sell|make)|my\s+shop)\b",
    "already_purchased": r"\b(?:already\s+(?:bought|ordered)|just\s+(?:bought|ordered|received)|i\s+(?:bought|ordered)|arrived\s+today)\b",
    "urgent_delivery": r"\b(?:tomorrow|tonight|this\s+weekend|next\s+week|overnight|urgent|asap|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+(?:[1-9]|1[0-4])\s+days?)\b",
    "negative_or_hypothetical": r"\b(?:don'?t\s+(?:want|need)|do\s+not\s+(?:want|need)|not\s+(?:looking|interested)|can'?t\s+afford|cannot\s+afford|if\s+i|joking|just\s+kidding)\b",
}


def assess_purchase_intent(text: str) -> dict[str, Any]:
    text = text.replace("’", "'")
    result: dict[str, Any] = {
        "version": VERSION, "tier": "excluded", "score": 0,
        "scene": None,
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
        if len(sentence) > 350 or not re.search(PET, sentence, re.I):
            continue
        product_context = bool(re.search(PRODUCT, sentence, re.I) and re.search(CUSTOM_CONTEXT, sentence, re.I))
        gift_context = bool(re.search(GIFT, sentence, re.I))
        # A general gift for a dog could mean food or toys. Require a photo /
        # personalized context; birthday/adoption alone is not purchase intent.
        relevant_gift = bool(gift_context and re.search(CUSTOM_CONTEXT, sentence, re.I)
                             and not re.search(UNRELATED_GIFT, sentence, re.I))
        if not product_context and not relevant_gift:
            continue
        request = re.search(REQUEST, sentence, re.I) or (relevant_gift and re.search(GIFT_REQUEST, sentence, re.I))
        tier, score = ("explicit_request", 80) if request else (
            ("exploratory", 50) if re.search(WISH, sentence, re.I) else ("excluded", 0)
        )
        if score > result["score"]:
            scene = "gift" if gift_context else "decor" if re.search(DECOR, sentence, re.I) else "custom"
            result.update(tier=tier, score=score, scene=scene, evidence=[sentence.strip()])
    if not result["score"]:
        result["exclusion_reasons"] = ["no_current_product_request"]
    return result
