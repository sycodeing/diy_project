"""Evidence-only life-scene personas for raw X review; never contact qualification."""
from __future__ import annotations

import re
from typing import Any

VERSION = "consumer-life-scenes-v2"
PERSONAS = ("pet_owner", "home_decorator", "relationship_memory")

SELLER = re.compile(
    r"\b(?:we\s+sell|we\s+(?:make|offer)\s+(?:custom|personalized|personalised|gifts?|merch|products?)|our\s+(?:shop|store|products?)|"
    r"shop\s+(?:now|our|my)|order\s+from\s+(?:our|my)|commissions?\s+open|"
    r"for\s+sale|dm\s+me\s+to\s+order|affiliate|use\s+(?:my\s+)?code|"
    r"my\s+shop|wholesale|book\s+a\s+viewing|shop\s+the\s+collection|"
    r"i\s+(?:sell|make)\s+(?:custom|personalized|personalised|gifts?|merch|products?))\b", re.I)
PHOTO = re.compile(r"\b(?:photo|picture|snapshot|portrait|image|album|memory|memories)\b", re.I)
PET_OWN = re.compile(r"\b(?:my|our)\s+(?:cat|dog|puppy|kitten|pup|pets?)(?:'s)?\b", re.I)
PET_SCENE = re.compile(
    r"\b(?:birthday|turns?\s+\w+\s+today|years?\s+of|again|always|every\s+day|"
    r"fell\s+asleep|steal(?:s|ing)?\s+my|on\s+my\s+(?:sofa|hoodie|lap|bed)|"
    r"first\s+(?:walk|trip|day)|this\s+(?:photo|picture)|made\s+me\s+smile)\b", re.I)
HOME_SELF = re.compile(r"\b(?:my|our)\s+(?:(?:new|first)\s+)?(?:home|house|apartment|flat|room|living\s+room|"
                       r"bedroom|sofa|couch|wall|corner|place)\b", re.I)
HOME_SCENE = re.compile(r"\b(?:decorat(?:e|ing|ed|ion)|redecorat\w*|arrang(?:e|ing|ed)|"
                        r"set(?:ting)?\s+up|display(?:ing|ed)?|hung|hanging|"
                        r"new\s+(?:sofa|room|home|apartment)|photos?\s+on\s+(?:the|my|our)\s+wall|"
                        r"family\s+photos?)\b", re.I)
REL_SELF = re.compile(r"\b(?:my|our)\s+(?:first\s+trip|wedding|anniversary|graduation|"
                      r"honeymoon|partner|wife|husband|sister|brother|mom|mum|dad|family|"
                      r"friend|friends|memories|story)\b", re.I)
REL_SCENE = re.compile(r"\b(?:anniversary|graduat(?:ion|ed)|wedding|honeymoon|"
                       r"first\s+trip|years?\s+together|remember|reminds?\s+me|"
                       r"still\s+makes?\s+me\s+smile|shared\s+memories|our\s+story)\b", re.I)
GENERIC_GREETING = re.compile(r"^\s*happy\s+(?:birthday|anniversary|graduation)\b[^.!?]*[.!?]?\s*$", re.I)
BUYING = re.compile(r"\b(?:i(?:'m|\s+am)\s+(?:shopping\s+for|buying|"
                    r"choosing\s+(?:a|an)\s+(?:gift|present|custom|pillow|cushion|print))|"
                    r"i\s+(?:want|need|plan)\s+to\s+(?:buy|order)|"
                    r"where\s+can\s+i\s+(?:buy|order)|any\s+recommendations?\s+for\s+(?:a|an)\s+"
                    r"(?:gift|present|custom|pillow|cushion|print))\b", re.I)
PHOTO_COVER = re.compile(r"\b(?:photo|picture|image)\b.{0,45}\b(?:pillow\s+cover|cushion\s+cover)\b|"
                         r"\b(?:pillow\s+cover|cushion\s+cover)\b.{0,45}\b(?:photo|picture|image)\b", re.I)
PHOTO_TOWEL = re.compile(r"\b(?:photo|picture|image)\b.{0,45}\b(?:face\s+towel)\b|"
                         r"\b(?:face\s+towel)\b.{0,45}\b(?:photo|picture|image)\b", re.I)
PILLOW = re.compile(r"\b(?:pillow|cushion)s?\b", re.I)
PILLOW_REJECTION = re.compile(r"\b(?:not\s+(?:a|any)?\s*|no\s+|without\s+)(?:pillow|cushion)s?\b", re.I)
OTHER_PRODUCT = re.compile(r"\b(?:keychain|sticker|pin|print|poster|mug|shirt|hoodie)s?\b", re.I)


def _result() -> dict[str, Any]:
    return {
        "version": VERSION, "tier": "excluded", "persona": None, "priority": "none",
        "shopping_intent": "unknown", "current_need": "unknown", "product_fit": "unknown",
        "person_fit": "unknown", "scenario_fit": "unknown", "conversation_angle": None,
        "evidence": [], "consumer_evidence": None, "scenario_evidence": None,
        "product_evidence": None, "recipient_evidence": None, "exclusion_reasons": [],
        "verification": [], "human_review_required": True, "contact_permission": False,
        "media_eligibility": "not_assessed", "specific_other_product": False,
        "continuity_evidence": "not_established_by_single_post",
        "evidence_strength": "none",
    }


def assess_consumer_profile(text: str, *, author_bio: str = "",
                            is_repost: bool = False) -> dict[str, Any]:
    """Preserve matched first-person scene evidence, independent of buying intent."""
    text = text.replace("’", "'").strip()
    result = _result()
    if is_repost:
        result["exclusion_reasons"] = ["repost_not_personal_scene"]
        return result
    seller = SELLER.search(text) or SELLER.search(author_bio)
    if seller:
        result.update(exclusion_reasons=["seller_or_reseller"], evidence=[seller.group(0)])
        return result
    if GENERIC_GREETING.fullmatch(text):
        result["exclusion_reasons"] = ["greeting_without_scene"]
        return result

    pet, pet_scene = PET_OWN.search(text), PET_SCENE.search(text)
    home, home_scene = HOME_SELF.search(text), HOME_SCENE.search(text)
    relation, relation_scene = REL_SELF.search(text), REL_SCENE.search(text)
    photo = PHOTO.search(text)
    if pet and pet_scene:
        result.update(persona="pet_owner", consumer_evidence=pet.group(0),
                      scenario_evidence=pet_scene.group(0),
                      conversation_angle="their own pet story or everyday moment",
                      verification=["pet_ownership_from_account", "continuity_not_proven",
                                    "product_fit", "contact_eligibility"])
    elif home and home_scene:
        result.update(persona="home_decorator", consumer_evidence=home.group(0),
                      scenario_evidence=home_scene.group(0),
                      conversation_angle="their own room or display arrangement",
                      verification=["personal_home_not_business", "product_fit", "contact_eligibility"])
    elif relation and relation_scene and photo:
        result.update(persona="relationship_memory", consumer_evidence=relation.group(0),
                      scenario_evidence=relation_scene.group(0),
                      conversation_angle="a shared memory they described",
                      verification=["relationship_context", "product_fit", "contact_eligibility"])
    if not result["persona"]:
        result["exclusion_reasons"] = ["no_first_person_life_scene"]
        return result

    result["tier"] = "exploratory"
    result["person_fit"] = "plausible_individual"
    result["scenario_fit"] = "plausible"
    result["evidence_strength"] = "specific_single_post_story" if (
        result["persona"] != "pet_owner" or re.search(r"\b(?:years?|birthday|first\s+trip)\b", text, re.I)
    ) else "single_post_self_report"
    result["priority"] = "medium" if result["evidence_strength"] == "specific_single_post_story" else "low"
    result["evidence"] = [result["consumer_evidence"], result["scenario_evidence"]]
    buying = BUYING.search(text)
    if buying:
        result["shopping_intent"] = "expressed"
        result["current_need"] = "open"
        result["evidence"].append(buying.group(0))
    towel = PHOTO_TOWEL.search(text)
    if towel:
        result["product_fit"] = "verified"
        result["product_evidence"] = towel.group(0)
    if not PILLOW_REJECTION.search(text):
        cover = PHOTO_COVER.search(text)
        pillow = PILLOW.search(text)
        if cover:
            result["product_fit"] = "verified"
            result["product_evidence"] = cover.group(0)
        elif pillow:
            result["product_fit"] = "adjacent"
            result["product_evidence"] = pillow.group(0)
    other = OTHER_PRODUCT.search(text)
    if other and result["product_fit"] != "verified" and result["current_need"] == "open":
        result.update(specific_other_product=True, product_fit="unknown", priority="low",
                      product_evidence=other.group(0))
        result["verification"].append("other_product_requested_check_fit_before_draft")
    return result
