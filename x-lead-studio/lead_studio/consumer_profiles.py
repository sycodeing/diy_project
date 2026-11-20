"""Evidence-only consumer personas for raw X review; never contact qualification."""
from __future__ import annotations

import re
from typing import Any

VERSION = "consumer-personas-v1"
PERSONAS = ("gift_giver", "identity_consumer", "group_organizer")

SELLER = re.compile(
    r"\b(?:we\s+(?:sell|make|offer)|i\s+(?:sell|make)\s+(?:custom|personalized|personalised|gifts?|merch|products?)|our\s+(?:shop|store|collection|products?)|"
    r"shop\s+(?:now|our|my)|order\s+from\s+(?:our|my)|commissions?\s+open|"
    r"for\s+sale|dm\s+me\s+to\s+order|use\s+(?:my\s+)?code|affiliate|"
    r"my\s+shop|wholesale|bulk\s+orders?\s+(?:open|available))\b", re.I)
RECIPIENT = re.compile(
    r"\b(?:for|to)\s+(?:my|our)\s+(?:sister|brother|mom|mother|dad|father|"
    r"wife|husband|partner|girlfriend|boyfriend|friend|daughter|son|teacher|"
    r"colleague|coworker|grandma|grandpa|aunt|uncle|parents?)\b", re.I)
GIFT = re.compile(r"\b(?:gift|present|surprise)\b", re.I)
GIFT_OPEN = re.compile(
    r"\b(?:i(?:'m|\s+am)\s+(?:planning|choosing|picking|looking|shopping|deciding)|"
    r"i\s+(?:need|want|plan|hope)\s+(?:to\s+)?(?:get|buy|find|make|give|a\s+gift)|"
    r"we(?:'re|\s+are)\s+(?:planning|choosing|looking)|"
    r"thinking\s+(?:of|about)\s+(?:getting|making|buying)|"
    r"any\s+(?:gift\s+)?(?:ideas|recommendations)|what\s+should\s+i\s+(?:get|buy))\b", re.I)
GIFT_RESOLVED = re.compile(
    r"\b(?:gift\s+sorted|already\s+(?:bought|ordered)|(?:bought|ordered|received)\s+"
    r"(?:her|him|them|my\s+\w+)\s+.{0,60}(?:gift|present|pillow)|"
    r"(?:gifted|gave)\s+(?:her|him|them)\b|(?:gift|present)\s+(?:arrived|delivered))\b", re.I)
INTEREST = re.compile(
    r"\b(?:pet|dog|cat|car|motorcycle|bike|guitar|concert|band|music|anime|game|"
    r"fandom|fan|cosplay|my\s+oc|original\s+character|my\s+character)\b", re.I)
MERCH = re.compile(
    r"\b(?:merch|merchandise|keychains?|stickers?|pins?|prints?|posters?|"
    r"pillow(?:\s+covers?)?s?|cushions?|shirts?|hoodies?|mugs?|keepsakes?|"
    r"custom|personalized|personalised)\b", re.I)
HISTORY = re.compile(
    r"\b(?:i\s+collect|i(?:'ve|\s+have)\s+bought|i\s+(?:buy|bought)|"
    r"my\s+collection|i(?:'m|\s+am)\s+collecting)\b", re.I)
ACTIVE = re.compile(
    r"\b(?:i\s+want|i(?:'m|\s+am)\s+(?:looking|planning|choosing|deciding)|"
    r"thinking\s+(?:of|about)\s+(?:getting|buying|making)|"
    r"where\s+can\s+i|any\s+recommendations|i\s+need|want\s+(?:something|a|to))\b", re.I)
HISTORICAL_PATTERN = re.compile(r"\b(?:collect|collection|for\s+years|this\s+year|over\s+the\s+years)\b", re.I)
CURRENT_RESOLVED = re.compile(
    r"\b(?:my\s+custom\s+.{0,45}\s+(?:just\s+arrived|arrived\s+today)|"
    r"exactly\s+what\s+i\s+wanted|already\s+(?:ordered|bought)\s+(?:the|my)\b)\b", re.I)
DIY = re.compile(r"\b(?:i(?:'m|\s+am)\s+(?:sewing|making|embroidering)|i\s+(?:will|plan\s+to)\s+(?:sew|make|embroider))\b", re.I)
CONSUMPTION_ACTION = re.compile(
    r"\b(?:i\s+(?:want|need)\s+(?:to\s+)?(?:buy|get|order|make|find)|"
    r"i(?:'m|\s+am)\s+(?:looking|planning|choosing|deciding)\s+(?:for\s+|to\s+(?:buy|get|order|make)\s+|a\s+|an\s+)|"
    r"thinking\s+(?:of|about)\s+(?:getting|buying|making)|where\s+can\s+i\s+(?:buy|get|order)|"
    r"any\s+recommendations\s+for|want\s+something\s+with)\b", re.I)
ORGANIZING = re.compile(
    r"\b(?:i(?:'m|\s+am)\s+(?:organizing|planning|hosting|coordinating)|"
    r"we(?:'re|\s+are)\s+(?:organizing|planning|hosting)|"
    r"i\s+(?:organize|host|plan)\s+our)\b", re.I)
GROUP = re.compile(r"\b(?:our|my)\s+(?:book\s+club|car\s+club|fan\s+club|club|team|group|class|choir|crew|community)\b", re.I)
EVENT = re.compile(
    r"\b(?:anniversary|meetup|event|reunion|party|gathering|celebration|"
    r"next\s+(?:month|week)|in\s+\d+\s+(?:days|weeks|months)|"
    r"for\s+\d+\s+(?:people|members|attendees))\b", re.I)
PHOTO_COVER = re.compile(r"\b(?:photo|picture|image)\b.{0,45}\b(?:pillow\s+cover|cushion\s+cover)\b|\b(?:pillow\s+cover|cushion\s+cover)\b.{0,45}\b(?:photo|picture|image)\b", re.I)
OTHER_PRODUCT = re.compile(r"\b(?:keychain|sticker|pin|print|poster|mug|shirt|hoodie)s?\b", re.I)
PILLOW = re.compile(r"\b(?:pillow|cushion)s?\b", re.I)


def _result() -> dict[str, Any]:
    return {
        "version": VERSION, "tier": "excluded", "persona": None, "priority": "none",
        "current_need": "unknown", "product_fit": "unknown", "evidence": [],
        "consumer_evidence": None, "scenario_evidence": None, "product_evidence": None,
        "recipient_evidence": None, "exclusion_reasons": [], "verification": [],
        "human_review_required": True, "contact_permission": False,
        "media_eligibility": "not_assessed",
    }


def assess_consumer_profile(text: str, *, author_bio: str = "") -> dict[str, Any]:
    """Classify an original post as one raw-review persona, preserving matched text."""
    text = text.replace("’", "'").strip()
    result = _result()
    seller = SELLER.search(text) or SELLER.search(author_bio)
    if seller:
        result.update(exclusion_reasons=["seller_or_reseller"], evidence=[seller.group(0)])
        return result
    # A completed gift or one-off custom purchase is not an open buyer node.
    # A prior purchase may prove affinity while a later clause opens a new need.
    new_need = CONSUMPTION_ACTION.search(text)
    resolved = GIFT_RESOLVED.search(text) or CURRENT_RESOLVED.search(text)
    if resolved and (not new_need or new_need.start() <= resolved.start()):
        result["exclusion_reasons"] = ["current_purchase_resolved"]
        return result
    if DIY.search(text):
        result["exclusion_reasons"] = ["self_made_not_customer"]
        return result

    recipient = RECIPIENT.search(text)
    gift = GIFT.search(text)
    open_gift = GIFT_OPEN.search(text)
    if gift and recipient and open_gift:
        result.update(tier="exploratory", persona="gift_giver", priority="high",
                      current_need="open", product_fit="unknown",
                      evidence=[open_gift.group(0), gift.group(0), recipient.group(0)],
                      consumer_evidence=open_gift.group(0), scenario_evidence=gift.group(0),
                      recipient_evidence=recipient.group(0),
                      verification=["recipient_and_occasion", "product_fit", "account_is_personal"])
    else:
        organizing = ORGANIZING.search(text)
        group = GROUP.search(text)
        event = EVENT.search(text)
        if organizing and group and event:
            result.update(tier="exploratory", persona="group_organizer", priority="medium",
                          current_need="open", product_fit="unknown",
                          evidence=[organizing.group(0), group.group(0), event.group(0)],
                          consumer_evidence=organizing.group(0), scenario_evidence=event.group(0),
                          verification=["self_use_not_resale", "group_size_and_deadline", "product_fit"])
        else:
            interest = INTEREST.search(text)
            merch = MERCH.search(text)
            history = HISTORY.search(text)
            active = CONSUMPTION_ACTION.search(text)
            if interest and merch and (history or active):
                ongoing = bool(active)
                if not ongoing and not HISTORICAL_PATTERN.search(text):
                    result["exclusion_reasons"] = ["single_completed_purchase"]
                    return result
                consumer = active or history
                result.update(tier="exploratory", persona="identity_consumer",
                              priority="medium" if ongoing else "low",
                              current_need="open" if ongoing else "unknown", product_fit="unknown",
                              evidence=[consumer.group(0), interest.group(0), merch.group(0)],
                              consumer_evidence=consumer.group(0), scenario_evidence=interest.group(0),
                              product_evidence=merch.group(0),
                              verification=["current_need" if not ongoing else "product_fit",
                                            "account_is_personal"])
    if result["tier"] == "excluded":
        result["exclusion_reasons"] = ["no_concrete_consumer_signal"]
        return result
    current_text = (text[new_need.start():] if new_need else text) if result["current_need"] == "open" else ""
    if PHOTO_COVER.search(current_text):
        result["product_fit"] = "verified"
    elif PILLOW.search(current_text) or OTHER_PRODUCT.search(current_text):
        result["product_fit"] = "adjacent"
    product = PHOTO_COVER.search(current_text) or PILLOW.search(current_text) or OTHER_PRODUCT.search(current_text)
    if product:
        result["product_evidence"] = product.group(0)
    return result
