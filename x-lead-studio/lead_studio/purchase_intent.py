"""Conservative, explainable conversation signals; never purchase probabilities."""
from __future__ import annotations

import re
from typing import Any

DEMAND_SEGMENT_KEYS = ("demand_custom", "demand_recommendation", "demand_gift", "demand_decor", "demand_reply", "demand_discussion")
DEMAND_SCENES = ("custom", "gift", "decor")
VERSION = "pet-demand-v8-shopping"
PRODUCT = r"\b(?:pillow(?:case|\s+cover)?s?|cushions?|portraits?|prints?|wall\s+art|keepsakes?|blankets?|mugs?|ornaments?|canvases|framed\s+(?:art|prints?|photos?)|tote\s+bags?|shirts?|sweatshirts?)\b"
PILLOW = r"\b(?:pillow(?:case|\s+cover)?s?|cushions?)\b"
PET = r"\b(?:dog|cat|puppy|kitten|pet)s?\b"
CUSTOM_CONTEXT = r"\b(?:portraits?|photos?|pictures?|custom|personalized|personalised)\b"
PET_PLACEMENT = r"\b(?:of|with)\s+(?:(?:my|our|their)\s+)?(?:dog|cat|puppy|kitten|pet)\b|\b(?:my|our|their)\s+(?:dog|cat|puppy|kitten|pet)\s+on\s+it\b"
REQUEST = r"\b(?:where\s+can\s+i|where\s+to\s+(?:buy|order)|(?:does|can)\s+any(?:one|body)\s+know|(?:can|could)\s+someone\s+recommend|any(?:one|body)\s+(?:know|recommend)|looking\s+for|i(?:'m|\s+am)\s+looking|recommendations?\s+for|i\s+(?:want|need|would\s+like)\s+to\s+(?:buy|order|commission)|i\s+(?:want|need)\s+(?:a|an|the)|want\s+to\s+get)\b"
SHOPPING_REQUEST = r"\b(?:where\s+(?:can\s+i|to)\s+(?:buy|get|order|find)|(?:can|could|does)\s+any(?:one|body)\s+(?:know|recommend)|(?:can|could)\s+someone\s+recommend|any(?:one|body)\s+(?:know|recommend)|(?:any|some)\s+(?:recommendations?|suggestions?)|recommendations?\s+for|looking\s+for|i(?:'m|\s+am)\s+(?:looking|shopping)\s+for|trying\s+to\s+find|who\s+(?:makes|sells)|how\s+much|can\s+i\s+(?:buy|order)|i\s+want\s+to\s+(?:buy|order|commission)|i\s+want\s+(?:a|an|the)\b|thinking\s+(?:of|about)\s+(?:buying|ordering))\b"
PHYSICAL_CONTEXT = r"\b(?:physical|printed|framed|canvas|paper|shipped|delivered)\b"
DIGITAL_ONLY = r"\b(?:digital\s+(?:portrait|art|print|drawing)|download(?:able)?|png\s+file|jpeg\s+file|jpg\s+file|profile\s+(?:pic|picture)|avatar|file\s+only|digital\s+only)\b"
OTHER_PRODUCT_ONLY = r"(?:\bonly\s+(?:mugs?|blankets?|ornaments?|portraits?|prints?|canvases|framed\s+(?:art|prints?|photos?))\b|\b(?:mugs?|blankets?|ornaments?|portraits?|prints?|canvases|framed\s+(?:art|prints?|photos?))\s+only\b)"
GIFT = r"\b(?:gifts?|presents?)\b"
DECOR = r"\b(?:decor(?:ating)?|sofa|couch|living\s+room|bedroom|wall\s+art)\b"
GIFT_REQUEST = r"\b(?:gift\s+(?:ideas?|recommendations?)|what\s+(?:can|should)\s+i\s+(?:buy|get)|need\s+(?:a\s+)?(?:gift|present))\b"
HUMAN_RECIPIENT = r"\b(?:wife|husband|partner|girlfriend|boyfriend|mom|mother|dad|father|sister|brother|friend|dog\s+(?:mom|dad|owner|lover)|cat\s+(?:mom|dad|owner|lover)|pet\s+(?:parent|owner|lover))s?\b"
SITTER_RECIPIENT = r"\b(?:my|our|the)\s+(?:cat|dog|pet)\s+sitter\b"
OWN_CAT_DOG = r"\b(?:my|our)\s+(?:cat|dog|kitten|puppy)s?\b"
SITTER_GIFT_ADVICE = r"\b(?:any\s+(?:gift\s+)?ideas?|(?:need|want|seeking)\s+(?:gift\s+)?(?:ideas?|recommendations?)|(?:can|could)\s+(?:anyone|anybody|someone)\s+recommend|looking\s+for|what\s+(?:should|can)\s+i\s+(?:get|buy))\b"
PET_LOVER = r"\b(?:dog|cat|pet)[-\s]+lov(?:er|ing)s?\b|\b(?:loves?|adores?)\s+(?:(?:my|our|her|his|their)\s+)?(?:\d+|one|two|three)?\s*(?:dog|cat|pet)s?\b|\b(?:dog|cat|pet)\s+(?:mom|dad|owner|parent|lover)s?\b"
UNRELATED_GIFT_ITEM = r"(?:toys?|treats?|food|leash(?:es)?|collars?|beds?)"
UNRELATED_GIFT = rf"\b{UNRELATED_GIFT_ITEM}\b"
WISH = r"\b(?:i\s+(?:want|wish|would\s+love)|would\s+look\s+(?:great|good)|thinking\s+(?:of|about)|decorating)\b"
EXCLUSIONS = {
    "sensitive_context": r"\b(?:passed\s+away|died|rainbow\s+bridge|cancer|tumou?r|surgery|gofundme|fundrais\w*|missing\s+(?:dog|cat)|lost\s+my\s+(?:dog|cat))\b",
    "seller_or_giveaway": r"\b(?:shop\s+now|for\s+sale|use\s+(?:my\s+)?code|commissions?\s+open|giveaway|affiliate|dm\s+(?:me\s+)?to\s+order|my\s+(?:#\w+\s+)?shop|our\s+(?:shop|store|guide|products?|collection)|we\s+(?:make|sell)|shop\s+(?:at|our)|order\s+from\s+our|buy\s+now|you\s+can\s+customiz[es]|customiz[es]\s+with\s+your)\b",
    "already_purchased": r"\b(?:already\s+(?:bought|ordered)|just\s+(?:bought|ordered|received)|i\s+(?:bought|ordered)|arrived\s+today)\b",
    "urgent_delivery": r"\b(?:tomorrow|tonight|this\s+weekend|next\s+week|overnight|urgent|asap|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+(?:[1-9]|1[0-4])\s+days?)\b",
    "negative_or_hypothetical": r"\b(?:don'?t\s+(?:want|need)|do\s+not\s+(?:want|need)|not\s+(?:looking|interested)|can'?t\s+afford|cannot\s+afford|if\s+i|one\s+day|someday|joking|just\s+kidding)\b",
}


def _sitter_gift_consultation(context: str) -> bool:
    """Require a buyer's own cat/dog, a sitter recipient, and a request for advice."""
    if (re.search(r"\bsitter's\s+(?:cat|dog|pet|kitten|puppy)\b", context, re.I)
            or re.search(r"\b(?:gift|present)\s+(?:for|to)\s+(?:my|our)\s+"
                         r"(?:cat|dog|pet)(?!\s+sitter)\b", context, re.I)):
        return False
    if not (re.search(SITTER_RECIPIENT, context, re.I)
            and re.search(OWN_CAT_DOG, context, re.I)
            and re.search(GIFT, context, re.I)
            and re.search(SITTER_GIFT_ADVICE, context, re.I)):
        return False
    sitter = r"(?:my|our|the)\s+(?:cat|dog|pet)\s+sitter"
    return bool(re.search(rf"\b(?:gift|present)\b.{{0,70}}\b(?:for|to)\s+{sitter}\b", context, re.I)
                or re.search(rf"\b(?:get|buy|give)\s+{sitter}\b.{{0,70}}\b(?:gift|present)\b", context, re.I))


def assess_purchase_intent(text: str) -> dict[str, Any]:
    text = text.replace("’", "'")
    result: dict[str, Any] = {
        "version": VERSION, "tier": "excluded", "score": 0,
        "scene": None, "audience": None, "product_fit": None,
        "evidence": [], "request_evidence": None, "product_evidence": None,
        "recipient_evidence": None, "exclusion_reasons": [],
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
    if re.search(DIGITAL_ONLY, text, re.I):
        result["exclusion_reasons"] = ["digital_only"]
        return result
    if re.search(OTHER_PRODUCT_ONLY, text, re.I) and not re.search(PILLOW, text, re.I):
        result["exclusion_reasons"] = ["product_mismatch"]
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
            related_sitter = (re.search(SITTER_RECIPIENT, sentence, re.I)
                              and re.search(r"\b(?:she|he|they)\b", following, re.I)
                              and re.search(OWN_CAT_DOG, following, re.I))
            related_order_constraint = (re.search(SHOPPING_REQUEST, sentence, re.I)
                                        and re.search(r"\b(?:it|one)\b", following, re.I)
                                        and (re.search(EXCLUSIONS["urgent_delivery"], following, re.I)
                                             or re.search(EXCLUSIONS["already_purchased"], following, re.I)))
            related_product_choice = (re.search(SHOPPING_REQUEST, sentence, re.I)
                                      and re.search(CUSTOM_CONTEXT, sentence, re.I)
                                      and re.search(r"\b(?:compar(?:e|ing)|choos(?:e|ing)|between)\b", following, re.I)
                                      and re.search(PRODUCT, following, re.I))
            if related_photo or related_gift or related_sitter or related_order_constraint or related_product_choice:
                context = f"{sentence}. {following}"
        if len(context) > 350 or not re.search(PET, context, re.I):
            continue
        if re.search(r"\b(?:not|no|instead\s+of)\s+(?:a\s+)?" + PILLOW, context, re.I):
            result["exclusion_reasons"].append("product_mismatch")
            continue
        product_match = re.search(PRODUCT, context, re.I)
        product_context = bool(product_match and
                               (re.search(CUSTOM_CONTEXT, context, re.I) or re.search(PET_PLACEMENT, context, re.I))
                               and (not re.search(r"\bportraits?\b", product_match.group(0), re.I)
                                    or re.search(PHYSICAL_CONTEXT, context, re.I)))
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
        sitter_gift = _sitter_gift_consultation(context) and not product_context
        relevant_gift = bool(gift_context and re.search(CUSTOM_CONTEXT, context, re.I)
                             and not unrelated_positive and not sitter_gift)
        gift_exploration = bool(not unrelated_positive and (
            sitter_gift or (gift_context and not product_context and not relevant_gift
                            and re.search(HUMAN_RECIPIENT, context, re.I)
                            and re.search(PET_LOVER, context, re.I)
                            and re.search(r"\b(?:i|my|we|our)\b", context, re.I)
                            and (re.search(GIFT_REQUEST, context, re.I) or re.search(REQUEST, context, re.I)))))
        if not product_context and not relevant_gift and not gift_exploration:
            continue
        if re.search(DIGITAL_ONLY, context, re.I):
            result["exclusion_reasons"].append("digital_only")
            continue
        excluded = next((reason for reason in ("already_purchased", "urgent_delivery", "negative_or_hypothetical")
                         if re.search(EXCLUSIONS[reason], context, re.I)), None)
        if excluded or re.search(r"\bi\s+(?:sell|make|create|offer)\b.{0,80}" + PRODUCT, context, re.I):
            result["exclusion_reasons"].append(excluded or "seller_or_giveaway")
            continue
        buyer_voice = bool(re.search(r"\b(?:i|my|we|our|anyone|anybody)\b", context, re.I))
        request = re.search(SHOPPING_REQUEST, context, re.I) or (sitter_gift and buyer_voice) or (
            (relevant_gift or gift_exploration) and buyer_voice and re.search(GIFT_REQUEST, context, re.I))
        request_evidence = (request.group(0) if isinstance(request, re.Match)
                            else re.search(SITTER_GIFT_ADVICE, context, re.I).group(0) if sitter_gift and request
                            else None)
        tier, score = ("explicit_request", 80) if request and not gift_exploration else ("excluded", 0)
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
                          evidence=[context], request_evidence=request_evidence,
                          product_evidence=product_match.group(0) if product_context and product_match else None,
                          recipient_evidence=(recipient.group(0) if (recipient := re.search(
                              SITTER_RECIPIENT + "|" + HUMAN_RECIPIENT, context, re.I)) else None),
                          exclusion_reasons=[])
    if not result["score"] and not result["exclusion_reasons"]:
        result["exclusion_reasons"] = ["wish_only" if re.search(WISH, text, re.I)
                                       else "no_current_product_request"]
    return result


def assess_reply_with_parent(reply_text: str, parent_text: str, parent_post_id: str) -> dict[str, Any]:
    """Use a verified parent only to resolve the product referred to by a buyer reply."""
    result = assess_purchase_intent(reply_text)
    if result["tier"] != "excluded" or not parent_post_id:
        return result
    if re.search(r"\b(?:not|no|instead\s+of)\s+(?:a\s+)?" + PILLOW, reply_text, re.I):
        return {**result, "exclusion_reasons": ["product_mismatch"]}
    if any(re.search(EXCLUSIONS[reason], reply_text, re.I)
           for reason in ("sensitive_context", "seller_or_giveaway", "already_purchased",
                          "urgent_delivery", "negative_or_hypothetical")):
        return result
    buyer_request = _parent_buyer_request(reply_text)
    reference = re.search(r"\b(?:one|this|it|same)\b", reply_text, re.I)
    short_price_question = re.fullmatch(r"\s*how\s+much(?:\s+(?:is|does)\s+(?:it|this)(?:\s+cost)?)?\s*[?.!]*\s*", reply_text, re.I)
    if not buyer_request or (not reference and not short_price_question):
        return result
    if any(re.search(EXCLUSIONS[reason], parent_text, re.I)
           for reason in ("sensitive_context", "negative_or_hypothetical")):
        return result
    parent_product = re.search(PRODUCT, parent_text, re.I)
    parent_is_pet_product = (parent_product and re.search(PET, parent_text, re.I)
                             and (re.search(CUSTOM_CONTEXT, parent_text, re.I)
                                  or re.search(PET_PLACEMENT, parent_text, re.I))
                             and (not re.search(r"\bportraits?\b", parent_product.group(0), re.I)
                                  or re.search(PHYSICAL_CONTEXT, parent_text, re.I))
                             and not re.search(DIGITAL_ONLY, parent_text, re.I))
    if not parent_is_pet_product:
        return result
    return {**result, "tier": "explicit_request", "score": 75, "scene": "custom",
            "audience": "direct_demand", "product_fit": "pillow" if re.search(PILLOW, parent_product.group(0), re.I) else "adjacent",
            "evidence": [reply_text.strip()[:350]], "exclusion_reasons": [],
            "request_evidence": buyer_request.group(0), "product_evidence": parent_product.group(0),
            "recipient_evidence": None,
            "parent_post_id": parent_post_id, "parent_evidence": parent_text.strip()[:350]}


def _parent_buyer_request(reply_text: str) -> re.Match[str] | None:
    return re.search(
        r"\b(?:can|could)\s+you\s+make\b|\bhow\s+much\b|\bwhere\s+can\s+i\s+(?:buy|get|order)\b|"
        r"\bcan\s+i\s+(?:buy|order|get)\b|\bi\s+want\s+(?:to\s+(?:buy|order)|(?:one|this|it))\b", reply_text, re.I,
    )


def needs_reply_parent_context(reply_text: str) -> bool:
    """True only for a buyer's unresolved reference to the parent product."""
    return bool(_parent_buyer_request(reply_text)
                and (re.search(r"\b(?:one|this|it|same)\b", reply_text, re.I)
                     or re.fullmatch(r"\s*how\s+much\s*[?.!]*\s*", reply_text, re.I)))
