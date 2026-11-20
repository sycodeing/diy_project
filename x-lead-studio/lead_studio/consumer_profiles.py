"""Evidence-only life-scene personas for raw X review; never contact qualification."""
from __future__ import annotations

import re
import unicodedata
from typing import Any

VERSION = "consumer-life-scenes-v2.2"
PERSONAS = ("pet_owner", "home_decorator", "relationship_memory")

SELLER = re.compile(
    r"\b(?:we\s+sell|we\s+(?:make|offer)\s+(?:custom|personalized|personalised|gifts?|merch|products?)|our\s+(?:shop|store|products?)|"
    r"shop\s+(?:now|our|my)|order\s+from\s+(?:our|my)|commissions?\s+open|"
    r"for\s+sale|dm\s+me\s+to\s+order|affiliate|use\s+(?:my\s+)?code|"
    r"my\s+shop|wholesale|book\s+a\s+viewing|shop\s+the\s+collection|"
    r"(?:producing|manufacturing)\s+.{0,100}\b(?:rugs?|toys?|products?|goods)\b|"
    r"(?:toymaker|tannery)\s+@\w+|"
    r"i\s+(?:sell|make)\s+(?:custom|personalized|personalised|gifts?|merch|products?))\b", re.I)
PHOTO = re.compile(r"\b(?:photo|picture|snapshot|portrait|image|album|memory|memories)\b", re.I)
PET_OWN = re.compile(r"\b(?:my|our)\s+(?:cat|dog|puppy|kitten|pup|pets?)(?:'s)?\b", re.I)
PET_SCENE = re.compile(
    r"\b(?:birthday|turns?\s+\w+\s+today|years?\s+of|every\s+day|"
    r"fell\s+asleep|steal(?:s|ing)?\s+my|on\s+my\s+(?:sofa|hoodie|lap|bed)|"
    r"first\s+(?:walk|trip|day)|this\s+(?:photo|picture)|made\s+me\s+smile|"
    r"just\s+did|just\s+let\s+me|throwback|petting|"
    r"(?:cat|dog)\s+photos?|purr(?:ed|ing)?)\b", re.I)
PET_SELF_REPORT = re.compile(
    r"\b(?:here(?:'s|\s+is)|this\s+is|meet)\s+(?:my|our)\s+(?:cat|dog|puppy|kitten|pup|pet)\b|"
    r"\b(?:my|our)\s+(?:cat|dog|puppy|kitten|pup|pet)(?:'s)?\b"
    r"[^.!?@\n]{0,30}\b(?:is|are|was|were|has|had|got|gets|does|did|"
    r"doesn't|didn't|just|always|sleeps?|fell|loves?|likes?|hates?|wants?|"
    r"needs?|looks?|passed|died|won't|can't|lives?|turns?)\b|"
    r"\b(?:i|we|my\s+(?:partner|husband|wife|bf|gf|son|daughter|friend))\b[^.!?@\n]{0,70}"
    r"\b(?:my|our)\s+(?:cat|dog|puppy|kitten|pup|pet)\b|"
    r"\b(?:my|our)\s+(?:cat|dog|puppy|kitten|pup|pet)\b[^.!?@\n]{0,70}\b(?:i|we|me|us|my|our)\b|"
    r"\b(?:photo|picture|image)\b[^.!?@\n]{0,45}\bof\s+(?:my|our)\s+(?:cat|dog|puppy|kitten|pup|pet)\b|"
    r"\b(?:why|how|when)\s+(?:does|did|is|was|will)\s+(?:my|our)\s+(?:cat|dog|puppy|kitten|pup|pet)\b|"
    r"\b(?:playing|staring|sleeping|sitting|walking|looking|petting)\b[^.!?@\n]{0,30}"
    r"\b(?:with|at|beside|near)\s+(?:my|our)\s+(?:cat|dog|puppy|kitten|pup|pet)\b|"
    r"\bwith\s+(?:my|our)\s+(?:cat|dog|puppy|kitten|pup|pet)\b|"
    r"\bgood\s+morning\s+from\s+(?:my|our)\s+(?:cat|dog|puppy|kitten|pup|pet)\b",
    re.I | re.S,
)
PET_NON_LITERAL = re.compile(
    r"\b(?:nickname|feline.personality|cat\s+b\s+(?:list|rookie)|"
    r"(?:my|our)\s+dog\s+portraits?|"
    r"(?:my|our)\s+(?:cat|dog)\s*\(\d{2}m\)|"
    r"(?:could|would)\s+also\s+be\s+my\s+dog|"
    r"\beven\s+if\b[^.!?\n]{0,80}\b(?:my|our)\s+(?:cat|dog)|"
    r"\bwould(?:n't|\s+not)\s+trust\b[^.!?\n]{0,80}\b(?:my|our)\s+(?:cat|dog)|"
    r"\b(?:my|our)\s+(?:cat|dog)\b[^.!?\n]{0,35}\b(?:than|then)\b[^.!?\n]{0,50}\b(?:people|these|them|they)\b|"
    r"\b(?:dream|dreamed|dreamt)\b[^.!?\n]{0,100}\b(?:my|our)\s+(?:cat|dog)|"
    r"\b(?:my|our)\s+(?:cat|dog)\b[^.!?\n]{0,120}\b(?:dream|dreamed|dreamt)\b|"
    r"\$[A-Z]{3,}\b[^.!?\n]{0,100}\b(?:my|our)\s+(?:cat|dog)|"
    r"\bsolana\b[^.!?\n]{0,100}\b(?:my|our)\s+(?:cat|dog)|"
    r"(?:\bCATE\b|\bsolana\b)[^.!?\n]{0,100}\bcat\(e\)|"
    r"\$\d+(?:\.\d+)?\b[^.!?\n]{0,80}\bsavings?\b)",
    re.I,
)
PET_FAN_BIO = re.compile(r"\b(?:fan(?:dom|atic)?|kpop|edits?\s*(?:&|and)\s*news|appreciation)\b", re.I)
PET_FAN_POST = re.compile(r"\b(?:brand\s+event|red\s+carpet|tour|idol|bias)\b|#[A-Za-z0-9_]+", re.I)
PET_UNCERTAIN = re.compile(r"\b(?:i\s+lost\s+my\s+(?:cat|dog)|avatar|vatar\w*|roleplay|"
                           r"witness\s+protection|report\s+you\s+to\s+my\s+dog|"
                           r"die\s+in\s+real\s+life|ai\s+email|community)\b", re.I)
PET_UNCERTAIN_BIO = re.compile(r"\b(?:fictional\s+character|roleplay|in\s+character|"
                              r"(?:princess|prince|queen|king)\s+of\s+the\s+\w+)\b", re.I)
PET_SENSITIVE = re.compile(r"\b(?:severe\s+pain|hospital|grief|bereavement|terminal\s+illness|"
                           r"no\s+more\s+bad\s+days|hold\s+on+|rip|hearts?\s+(?:are|is)\s+broken|"
                           r"suicid\w*|kill\s+yourself|war|vet|arthritis|kidney\s+disease|"
                           r"passed\s+away|died|er\s+vet|vaccin\w*|spiral\w*|"
                           r"still\s+alive|put\s+our\s+dog\s+.{0,25}to\s+sleep|"
                           r"(?:abusive|neglectful|hoarder)|jabs?)\b", re.I)
INSTITUTION_BIO = re.compile(r"\b(?:registered\s+charity|reg\.\s*charity\s+no\.|"
                             r"rescue\s+team\s+based\s+in)\b", re.I)
HOME_SELF = re.compile(r"\b(?:my|our)\s+(?:(?:new|first)\s+)?(?:home|house|apartment|flat|room|living\s+room|"
                       r"bedroom|sofa|couch|wall|corner|place)\b", re.I)
HOME_SCENE = re.compile(r"\b(?:decorat(?:e|ing|ed|ion)|redecorat\w*|"
                        r"arrang(?:e|ing|ed)\s+(?:my|our|the)\s+(?:new\s+)?(?:sofa|room|photos?|furniture|wall|corner)|"
                        r"set(?:ting)?\s+up|display(?:ing|ed)?|hung|hanging|framed|"
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
FICTION_FRAME = re.compile(
    r"\b(?:the\s+stories\s+here\s+are\s+fictional|"
    r"i\s+write\s+the\s+relationship\s+stories|"
    r"book\s+\d+.{0,100}\b(?:act|chapter|scene)\s+[ivx\d]+)\b", re.I | re.S)


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
        "needs_context_review": False, "experience_phase": "unknown",
    }


def _linked(first: re.Pattern[str], second: re.Pattern[str], text: str,
            *, max_distance: int = 120) -> tuple[re.Match[str], re.Match[str]] | None:
    pairs = [(a, b) for a in first.finditer(text) for b in second.finditer(text)
             if abs(a.start() - b.start()) <= max_distance]
    return min(pairs, key=lambda pair: abs(pair[0].start() - pair[1].start())) if pairs else None


def assess_consumer_profile(text: str, *, author_bio: str = "",
                            is_repost: bool = False) -> dict[str, Any]:
    """Preserve matched first-person scene evidence, independent of buying intent."""
    text = text.replace("’", "'").strip()
    normalized_bio = unicodedata.normalize("NFKC", author_bio)
    result = _result()
    if is_repost:
        result["exclusion_reasons"] = ["repost_not_personal_scene"]
        return result
    seller = SELLER.search(text) or SELLER.search(author_bio)
    if seller:
        result.update(exclusion_reasons=["seller_or_reseller"], evidence=[seller.group(0)])
        return result
    institution = INSTITUTION_BIO.search(author_bio)
    if institution:
        result.update(exclusion_reasons=["institution_not_personal_account"],
                      evidence=[institution.group(0)])
        return result
    fiction = FICTION_FRAME.search(text) or FICTION_FRAME.search(author_bio)
    if not fiction and re.search(r"\b(?:stories|fiction|novel|movies)\b", author_bio, re.I):
        fiction = re.search(r"\b(?:there\s+is\s+this|we\s+call\s+it|book\s+\d+|act\s+[ivx\d]+|scene\s+[ivx\d]+)\b", text, re.I)
    if fiction:
        result.update(exclusion_reasons=["fictional_narrative_not_personal_scene"],
                      evidence=[fiction.group(0)])
        return result
    if GENERIC_GREETING.fullmatch(text):
        result["exclusion_reasons"] = ["greeting_without_scene"]
        return result

    pet_pair = _linked(PET_OWN, PET_SCENE, text)
    if pet_pair and re.search(r"[.!?@\n]", text[min(pet_pair[0].end(), pet_pair[1].end()):max(pet_pair[0].start(), pet_pair[1].start())]):
        pet_pair = None
    pet_self_report = PET_SELF_REPORT.search(text)
    pet_owner = PET_OWN.search(text)
    pet_non_literal = PET_NON_LITERAL.search(text) or (PET_FAN_BIO.search(author_bio) and PET_FAN_POST.search(text))
    if pet_owner and re.search(r"\b(?:my|our)\s+(?:cat|dog)\s*\(\d{2}m\)", text, re.I):
        pet_non_literal = True
    if pet_owner and re.search(r'["“][^"”]{0,150}\b(?:my|our)\s+(?:cat|dog)\b[^"”]{0,150}["”]', text, re.I):
        pet_non_literal = True
    home_pair = _linked(HOME_SELF, HOME_SCENE, text)
    relation_pair = _linked(REL_SELF, REL_SCENE, text)
    photo = PHOTO.search(text)
    if pet_owner and (pet_pair or pet_self_report) and not pet_non_literal:
        pet = pet_pair[0] if pet_pair else pet_owner
        pet_scene = pet_pair[1] if pet_pair else pet_self_report
        result.update(persona="pet_owner", consumer_evidence=pet.group(0),
                      scenario_evidence=pet_scene.group(0),
                      conversation_angle="their own pet story or everyday moment",
                      verification=["pet_ownership_from_account", "continuity_not_proven",
                                    "product_fit", "contact_eligibility"])
    elif home_pair:
        home, home_scene = home_pair
        result.update(persona="home_decorator", consumer_evidence=home.group(0),
                      scenario_evidence=home_scene.group(0),
                      conversation_angle="their own room or display arrangement",
                      verification=["personal_home_not_business", "product_fit", "contact_eligibility"])
    elif relation_pair and photo and min(abs(photo.start() - part.start()) for part in relation_pair) <= 200:
        relation, relation_scene = relation_pair
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
    if result["persona"] == "relationship_memory":
        result["experience_phase"] = ("future_planned" if re.search(
            r"\b(?:i\s+want\s+to|planning|next\s+(?:year|month)|will\s+be)\b", text, re.I)
            else "past_or_current")
        if result["experience_phase"] == "future_planned":
            result["conversation_angle"] = "a future family occasion they are planning"
    uncertain_pet = result["persona"] == "pet_owner" and bool(
        PET_UNCERTAIN.search(text) or PET_UNCERTAIN_BIO.search(normalized_bio))
    if uncertain_pet:
        result["person_fit"] = "uncertain_self_report"
        result["evidence_strength"] = "ambiguous_single_post"
    if result["persona"] == "pet_owner" and (PET_SENSITIVE.search(text) or uncertain_pet):
        result["needs_context_review"] = True
        result["priority"] = "low"
        result["verification"].append("context_uncertain_or_sensitive_do_not_pitch")
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
