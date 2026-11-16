"""Conservative, explainable conversation signals; never purchase probabilities."""
from __future__ import annotations

import re
from typing import Any

DEMAND_SEGMENT_KEYS = ("demand_custom", "demand_recommendation", "demand_gift", "demand_decor", "demand_reply")
DEMAND_SCENES = ("custom", "gift", "decor")
VERSION = "pet-demand-v5"
PRODUCT = r"\b(?:pillow(?:case|\s+cover)?s?|cushions?|portraits?|prints?|wall\s+art|keepsakes?)\b"
PILLOW = r"\b(?:pillow(?:case|\s+cover)?s?|cushions?)\b"
PET = r"\b(?:dog|cat|puppy|kitten|pet)s?\b"
CUSTOM_CONTEXT = r"\b(?:portraits?|photos?|pictures?|custom|personalized|personalised)\b"
PET_PLACEMENT = r"\b(?:of|with)\s+(?:(?:my|our|their)\s+)?(?:dog|cat|puppy|kitten|pet)\b|\b(?:my|our|their)\s+(?:dog|cat|puppy|kitten|pet)\s+on\s+it\b"
REQUEST = r"\b(?:where\s+can\s+i|where\s+to\s+(?:buy|order)|(?:does|can)\s+any(?:one|body)\s+know|(?:can|could)\s+someone\s+recommend|any(?:one|body)\s+(?:know|recommend)|looking\s+for|i(?:'m|\s+am)\s+looking|recommendations?\s+for|i\s+(?:want|need|would\s+like)\s+to\s+(?:buy|order|commission)|i\s+(?:want|need)\s+(?:a|an|the)|want\s+to\s+get)\b"
GIFT = r"\b(?:gifts?|presents?)\b"
DECOR = r"\b(?:decor(?:ating)?|sofa|couch|living\s+room|bedroom|wall\s+art)\b"
GIFT_REQUEST = r"\b(?:gift\s+(?:ideas?|recommendations?)|what\s+(?:can|should)\s+i\s+(?:buy|get)|need\s+(?:a\s+)?(?:gift|present))\b"
HUMAN_RECIPIENT = r"\b(?:wife|husband|partner|girlfriend|boyfriend|mom|mother|dad|father|sister|brother|friend|dog\s+(?:mom|dad|owner|lover)|cat\s+(?:mom|dad|owner|lover)|pet\s+(?:parent|owner|lover))s?\b"
PET_LOVER = r"\b(?:dog|cat|pet)[-\s]+lov(?:er|ing)s?\b|\b(?:loves?|adores?)\s+(?:(?:my|our|her|his|their)\s+)?(?:dog|cat|pet)s?\b|\b(?:dog|cat|pet)\s+(?:mom|dad|owner|parent|lover)s?\b"
UNRELATED_GIFT_ITEM = r"(?:toys?|treats?|food|leash(?:es)?|collars?|beds?)"
UNRELATED_GIFT = rf"\b{UNRELATED_GIFT_ITEM}\b"
WISH = r"\b(?:i\s+(?:want|wish|would\s+love)|would\s+look\s+(?:great|good)|thinking\s+(?:of|about)|decorating)\b"
EXCLUSIONS = {
    "sensitive_context": r"\b(?:passed\s+away|died|rainbow\s+bridge|cancer|tumou?r|surgery|gofundme|fundrais\w*|missing\s+(?:dog|cat)|lost\s+my\s+(?:dog|cat))\b",
    "seller_or_giveaway": r"\b(?:shop\s+now|for\s+sale|use\s+(?:my\s+)?code|commissions?\s+open|giveaway|affiliate|dm\s+(?:me\s+)?to\s+order|my\s+shop|our\s+shop|buy\s+now)\b",
    "already_purchased": r"\b(?:already\s+(?:bought|ordered)|just\s+(?:bought|ordered|received)|i\s+(?:bought|ordered)|arrived\s+today)\b",
    "urgent_delivery": r"\b(?:tomorrow|tonight|this\s+weekend|next\s+week|overnight|urgent|asap|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+(?:[1-9]|1[0-4])\s+days?)\b",
    "negative_or_hypothetical": r"\b(?:don'?t\s+(?:want|need)|do\s+not\s+(?:want|need)|not\s+(?:looking|interested)|can'?t\s+afford|cannot\s+afford|if\s+i|joking|just\s+kidding)\b",
}


def assess_purchase_intent(text: str) -> dict[str, Any]:
    text = text.replace("’", "'")
    result: dict[str, Any] = {
        "version": VERSION, "tier": "excluded", "score": 0,
        "scene": None, "audience": None, "product_fit": None,
        "evidence": [], "exclusion_reasons": [],
        "human_review_required": True, "contact_permission": False,
    }
    # Sensitive situations and unambiguous selling language apply to the post.
    # Other negatives belong to the buyer request, not an unrelated sentence.
    for reason in ("sensitive_context", "seller_or_giveaway"):
        pattern = EXCLUSIONS[reason]
        match = re.search(pattern, text, re.I)
        if match:
            result["exclusion_reasons"].append(reason)
            result["evidence"].append(match.group(0))
    if result["exclusion_reasons"]:
        return result
    # Adjacent sentences can describe one request ("custom pillow? My cat on
    # it"), but unrelated paragraphs must not supply missing buyer evidence.
    sentences = [part.strip() for part in re.split(r"[.!?\n]+", text) if part.strip()]
    for index, sentence in enumerate(sentences):
        context = sentence
        if index + 1 < len(sentences) and len(sentence) + len(sentences[index + 1]) <= 350:
            following = sentences[index + 1]
            related_photo = re.search(r"\b(?:on\s+(?:it|one)|of\s+(?:my|our)|with\s+(?:my|our)|"
                                      r"(?:my|our)\s+(?:dog|cat|pet|puppy|kitten)\s+(?:on|photo|picture))\b", following, re.I)
            related_gift = (re.search(GIFT_REQUEST, sentence, re.I)
                            and re.search(HUMAN_RECIPIENT, sentence, re.I)
                            and re.search(r"\b(?:she|he|they)\s+(?:loves?|adores?)\b", following, re.I)
                            and re.search(PET, following, re.I))
            if related_photo or related_gift:
                context = f"{sentence}. {following}"
        if len(context) > 350 or not re.search(PET, context, re.I):
            continue
        product_context = bool(re.search(PRODUCT, context, re.I) and
                               (re.search(CUSTOM_CONTEXT, context, re.I) or re.search(PET_PLACEMENT, context, re.I)))
        gift_context = bool(re.search(GIFT, context, re.I) or re.search(GIFT_REQUEST, context, re.I))
        # A general gift for a dog could mean food or toys. Require a photo /
        # personalized context; birthday/adoption alone is not purchase intent.
        # Remove only negated supply items; "no toys, but food" still asks for food.
        positive_text = re.sub(
            rf"\b(?:no|not|without|skip|instead\s+of)\s+(?:(?:a|any|more)\s+)?"
            rf"{UNRELATED_GIFT_ITEM}(?:\s*(?:,|or|and)\s*{UNRELATED_GIFT_ITEM})*",
            "", context, flags=re.I,
        )
        unrelated_positive = re.search(UNRELATED_GIFT, positive_text, re.I)
        relevant_gift = bool(gift_context and re.search(CUSTOM_CONTEXT, context, re.I)
                             and not unrelated_positive)
        gift_exploration = bool(gift_context and not product_context and not relevant_gift
                                and re.search(HUMAN_RECIPIENT, context, re.I)
                                and re.search(PET_LOVER, context, re.I)
                                and re.search(r"\b(?:i|my|we|our)\b", context, re.I)
                                and (re.search(GIFT_REQUEST, context, re.I) or re.search(REQUEST, context, re.I))
                                and not unrelated_positive)
        if not product_context and not relevant_gift and not gift_exploration:
            continue
        excluded = next((reason for reason in ("already_purchased", "urgent_delivery", "negative_or_hypothetical")
                         if re.search(EXCLUSIONS[reason], context, re.I)), None)
        if excluded or re.search(r"\bi\s+(?:sell|make|create|offer)\b.{0,80}" + PRODUCT, context, re.I):
            result["exclusion_reasons"].append(excluded or "seller_or_giveaway")
            continue
        if re.search(r"\b(?:not|no|instead\s+of)\s+(?:a\s+)?" + PILLOW, context, re.I):
            result["exclusion_reasons"].append("product_mismatch")
            continue
        buyer_voice = bool(re.search(r"\b(?:i|my|we|our|anyone|anybody)\b", context, re.I))
        request = re.search(REQUEST, context, re.I) or ((relevant_gift or gift_exploration)
                                                       and buyer_voice and re.search(GIFT_REQUEST, context, re.I))
        tier, score = ("explicit_request", 80) if request and not gift_exploration else (
            ("exploratory", 50) if re.search(WISH, context, re.I) else ("excluded", 0)
        )
        if gift_exploration and request:
            tier, score = "exploratory", 45
        product_fit = "pillow" if re.search(PILLOW, context, re.I) else "adjacent"
        if tier == "explicit_request" and product_fit == "adjacent":
            score = 60
        if score > result["score"]:
            scene = "gift" if gift_context else "decor" if re.search(DECOR, context, re.I) else "custom"
            result.update(tier=tier, score=score, scene=scene,
                          audience="gift_exploration" if gift_exploration else "direct_demand",
                          product_fit=product_fit,
                          evidence=[context], exclusion_reasons=[])
    if not result["score"]:
        if not result["exclusion_reasons"]:
            result["exclusion_reasons"] = ["no_current_product_request"]
    return result


def assess_reply_with_parent(reply_text: str, parent_text: str, parent_post_id: str) -> dict[str, Any]:
    """Use a verified parent only to resolve the product referred to by a buyer reply."""
    result = assess_purchase_intent(reply_text)
    if result["tier"] != "excluded" or not parent_post_id:
        return result
    if any(re.search(EXCLUSIONS[reason], reply_text, re.I)
           for reason in ("sensitive_context", "seller_or_giveaway", "already_purchased",
                          "urgent_delivery", "negative_or_hypothetical")):
        return result
    buyer_request = re.search(
        r"\b(?:can|could)\s+you\s+make\b|\bhow\s+much\b|\bwhere\s+can\s+i\s+(?:buy|get|order)\b|"
        r"\bi\s+(?:want|need|would\s+love)\b|\bi'd\s+love\b", reply_text, re.I,
    )
    reference = re.search(r"\b(?:one|this|it|same)\b", reply_text, re.I)
    if not buyer_request or not reference:
        return result
    if any(re.search(EXCLUSIONS[reason], parent_text, re.I)
           for reason in ("sensitive_context", "negative_or_hypothetical")):
        return result
    parent_is_pet_pillow = (re.search(PILLOW, parent_text, re.I)
                            and re.search(PET, parent_text, re.I)
                            and (re.search(CUSTOM_CONTEXT, parent_text, re.I)
                                 or re.search(PET_PLACEMENT, parent_text, re.I)))
    if not parent_is_pet_pillow:
        return result
    return {**result, "tier": "explicit_request", "score": 75, "scene": "custom",
            "audience": "direct_demand", "product_fit": "pillow",
            "evidence": [reply_text.strip()[:350]], "exclusion_reasons": [],
            "parent_post_id": parent_post_id, "parent_evidence": parent_text.strip()[:350]}
