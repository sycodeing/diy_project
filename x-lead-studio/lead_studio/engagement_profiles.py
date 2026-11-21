"""Conservative, evidence-preserving raw review of three conversation sources."""
from __future__ import annotations

import re
from typing import Any

from .consumer_profiles import SELLER, PET_SENSITIVE, assess_consumer_profile

VERSION = "consumer-engagement-v1"
PRODUCT = re.compile(r"\b(?:custom|personalized|personalised|photo)\s+(?:pet\s+)?(?:pillow|cushion|cover|gift|portrait)|\b(?:pillow|cushion)\s+cover\b", re.I)
SELF = re.compile(r"\b(?:my|our)\s+(?:cat|dog|pet|puppy|kitten)\b|\b(?:i|we)\s+(?:made|drew|designed|printed|customized)\b", re.I)
QUESTION = re.compile(r"\?|\b(?:what do you think|any thoughts|would you|can you|could you|how can i|where can i)\b", re.I)
FINISHED = re.compile(r"\b(?:arrived|received|already (?:ordered|bought)|finished|completed)\b", re.I)
CATALOG_PRODUCT = re.compile(r"\b(?:photo|custom|personalized|personalised)?\s*(?:pillow|cushion)(?:\s+cover)?\b", re.I)
SELF_USE = re.compile(r"\b(?:for myself|for my own|our home|my home|my room|our room|my dog|our dog|my cat|our cat|for my (?:partner|family|friend))\b", re.I)


def assess_engagement_post(text: str, *, bio: str = "", source: str,
                           seed_text: str = "", direct_parent: bool = False,
                           is_repost: bool = False) -> dict[str, Any]:
    """A raw pool decision. Seed context never grants the reply's personal evidence."""
    own = text[:3000]
    seller = bool(SELLER.search(own) or SELLER.search(bio))
    excluded = is_repost or seller
    reasons = (["repost"] if is_repost else []) + (["seller_or_reseller"] if seller else [])
    personal = SELF.search(own)
    if source == "pet_share":
        old = assess_consumer_profile(own, author_bio=bio, is_repost=is_repost)
        has_person = old.get("persona") == "pet_owner" and old.get("person_fit") != "uncertain_self_report"
        if not has_person and not excluded:
            reasons.append("no_clear_personal_pet_evidence")
    elif source == "thread_participant":
        has_person = bool(personal)
        if not has_person and not excluded:
            reasons.append("participant_personal_evidence_pending")
    elif source == "personal_make":
        has_person = bool(personal and re.search(r"\b(?:i|we)\s+(?:made|drew|designed|printed|customized)\b", own, re.I))
        if not has_person and not excluded:
            reasons.append("personal_use_not_established")
    else:
        raise ValueError("Unknown source")
    tier = "excluded" if excluded or not has_person else "exploratory"
    own_product = CATALOG_PRODUCT.search(own) or PRODUCT.search(own)
    relation = "direct_text" if own_product else ("thread_context_only" if seed_text and PRODUCT.search(seed_text) else "unknown")
    finished = any(FINISHED.search(clause) and CATALOG_PRODUCT.search(clause)
                   for clause in re.split(r"[.!?\n]", own))
    question = bool(QUESTION.search(own))
    sensitive = bool(PET_SENSITIVE.search(own))
    entry = own[:240] if question and tier == "exploratory" else None
    return {
        "version": VERSION, "tier": tier, "persona": source if tier != "excluded" else None,
        "priority": "low", "exclusion_reasons": reasons,
        "personal_evidence": personal.group(0) if personal and tier != "excluded" else None,
        "self_use_evidence": SELF_USE.search(own).group(0) if source == "personal_make" and SELF_USE.search(own) else None,
        "product_relation": relation, "product_evidence": own_product.group(0) if own_product else None,
        "conversation_entry": entry, "current_need": "resolved_same_catalog_product" if finished else "unknown",
        "direct_parent_status": ("seed_is_direct_parent" if direct_parent else
                                 "thread_context_known_direct_parent_unknown" if seed_text else "not_applicable"),
        "seed_evidence": seed_text[:500] if seed_text else None,
        "needs_context_review": sensitive, "semantic_status": "pending",
        "media_semantic_status": "pending", "media_eligibility": "unverified",
        "draft_ready": False, "human_approved": False, "contact_permission": False,
        "verification": ["account_identity", "product_fit", "photo_ownership"],
    }


def merge_semantic_review(intent: dict[str, Any], verdict: dict[str, Any],
                          own_text: str, seed_text: str = "") -> dict[str, Any]:
    """Only accept model evidence quoted exactly from the supplied source."""
    if not isinstance(verdict, dict):
        return intent
    for key in ("seller", "fictional_or_nonliteral", "specific_product_relation", "current_need_resolved", "personal_use"):
        if type(verdict.get(key)) is not bool:
            return {**intent, "semantic_status": "invalid_model_output"}
    evidence = verdict.get("personal_quote")
    product = verdict.get("product_quote")
    entry = verdict.get("conversation_quote")
    if any(value is not None and (not isinstance(value, str) or not value.strip() or value not in source)
           for value, source in ((evidence, own_text), (product, own_text), (entry, own_text))):
        return {**intent, "semantic_status": "invalid_evidence"}
    if verdict.get("seller") is True or verdict.get("fictional_or_nonliteral") is True:
        return {**intent, "tier": "excluded", "persona": None, "priority": "none",
                "exclusion_reasons": [*intent["exclusion_reasons"], "semantic_seller_or_nonliteral"],
                "semantic_status": "reviewed", "draft_ready": False}
    if intent["tier"] != "exploratory":
        return {**intent, "semantic_status": "reviewed"}
    product_span = product or intent.get("product_evidence")
    relation = "direct_text" if product_span and verdict.get("specific_product_relation") is True else intent["product_relation"]
    finished = verdict.get("current_need_resolved") is True or intent["current_need"] == "resolved_same_catalog_product"
    entry = entry or intent["conversation_entry"]
    return {**intent, "personal_evidence": evidence or intent["personal_evidence"],
            "self_use_evidence": (evidence or intent.get("self_use_evidence") if verdict.get("personal_use") is True else None)
            if intent.get("persona") == "personal_make" else intent.get("self_use_evidence"),
            "semantic_personal_use": verdict.get("personal_use") is True,
            "product_relation": relation, "product_evidence": product_span,
            "conversation_entry": entry, "current_need": "resolved_same_catalog_product" if finished else "unknown",
            "semantic_status": "reviewed",
            "semantic_specific_relation": bool(product_span and verdict.get("specific_product_relation") is True),
            "priority": "medium" if evidence and entry and not finished else "low",
            "draft_ready": False}


def finalize_draft_gate(intent: dict[str, Any], *, media_review: dict[str, Any] | None = None) -> dict[str, Any]:
    """Permit only a text draft for human review, never contact approval."""
    quote = str(intent.get("product_evidence") or "")
    explicit_cover = bool(re.search(r"\b(?:photo|custom|personalized|personalised)\b.{0,35}\b(?:pillow|cushion)\s+cover\b", quote, re.I))
    adjacent_project = bool(re.search(r"\b(?:photo|picture|collage)\b", quote, re.I)
                            and re.search(r"\b(?:home|room|corner|sofa|couch)\b", quote, re.I))
    image_needed = adjacent_project and not explicit_cover
    image_ok = bool(media_review and media_review.get("status") == "local_model_review"
                    and media_review.get("category") in {"real_pet_photo", "artwork"})
    parent_ok = intent.get("persona") != "thread_participant" or intent.get("direct_parent_status") == "seed_is_direct_parent"
    ready = bool(intent.get("tier") == "exploratory" and intent.get("semantic_status") == "reviewed"
                 and intent.get("semantic_specific_relation") is True
                 and intent.get("personal_evidence") and intent.get("product_evidence")
                 and intent.get("conversation_entry") and (explicit_cover or adjacent_project)
                 and (intent.get("persona") != "personal_make" or
                      (intent.get("semantic_personal_use") is True and intent.get("self_use_evidence")))
                 and (not image_needed or image_ok) and parent_ok
                 and intent.get("current_need") != "resolved_same_catalog_product"
                 and not intent.get("needs_context_review"))
    return {**intent, "catalog_relation": ("verified_photo_pillow_cover" if explicit_cover else
                                           "adjacent_photo_home" if adjacent_project else "unknown"),
            "draft_ready": ready, "human_approved": False, "contact_permission": False}
