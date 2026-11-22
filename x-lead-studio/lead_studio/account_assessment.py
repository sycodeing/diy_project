"""Account-first, evidence-preserving assessment of a reply author's own posts.

This is a raw-review decision, never a qualification or permission to contact.
"""
from __future__ import annotations

import re
from typing import Any

from .consumer_profiles import FICTION_FRAME, SELLER, PET_SENSITIVE
from probe_consumer_recall import is_repost
from probe_purchase_recall import _author_bio, extract_post_photo_urls

VERSION = "account-first-v1.1"
PET = re.compile(r"\b(?:my|our)\s+(?:cat|dog|pet|kitten|puppy)\b", re.I)
PERSONAL_PROJECT = re.compile(
    r"\b(?:i|we)\s+(?:made|designed|painted|drew|commissioned|displayed|decorated|customized|personalized)\b"
    r".{0,90}\b(?:tag|portrait|photo|picture|pillow|cushion|towel|collar|room|wall|home|gift)\b",
    re.I,
)
RESOLVED = re.compile(r"\b(?:arrived|received|already (?:bought|ordered)|finished)\b.{0,50}\b(?:pillow|cushion)(?:\s+cover)?\b|\b(?:pillow|cushion)(?:\s+cover)?\b.{0,50}\b(?:arrived|received|already (?:bought|ordered)|finished)\b", re.I)
ENTRY = re.compile(r"\b(?:my|our|i|we)\b.{0,180}\b(?:cat|dog|pet|portrait|photo|picture|room|home|tag|pillow|cushion)\b", re.I)
HYPOTHETICAL = re.compile(r"\b(?:if i|if we|would|could|might|maybe|imagine)\b", re.I)
HOME_PROJECT = re.compile(
    r"\b(?:my|our)\s+(?:living\s+room|bedroom|room|home|house|apartment|gallery\s+wall|wall)\b"
    r".{0,110}\b(?:decor(?:at(?:e|ed|ing|ion))?|redecorat\w*|redo(?:ing|ne)?|"
    r"arrang\w*|display\w*|framed?|hang\w*|gallery\s+wall|trinkets?)\b|"
    r"\b(?:i(?:'m| am)?|we(?:'re| are)?)\s+(?:decorat\w*|redecorat\w*|redo\w*|"
    r"arrang\w*|display\w*|fram\w*|hang\w*)\b.{0,90}"
    r"\b(?:my|our)\s+(?:living\s+room|bedroom|room|home|wall|photos?|pictures?)\b|"
    r"\b(?:done|finished|completed)\s+(?:my|our)\s+(?:living\s+room|bedroom|room|home|wall)\b"
    r".{0,60}\b(?:decor|gallery|photos?|pictures?)\b",
    re.I,
)
PUBLISHER_BIO = re.compile(
    r"\b(?:home|decor|interior|furniture|kitchen|small.space)\b.{0,45}"
    r"\b(?:finds|ideas|guides|tips|trends|gear|content)\b",
    re.I,
)
PUBLISHER_POST = re.compile(r"\b(?:you\s+(?:should|can)|tips?\s+(?:for|to)|"
                            r"how\s+to|buying\s+guide|design\s+trends?|"
                            r"(?:try|choose|pick|skip|measure|tuck)\s+(?:a|the|your|it|one)|"
                            r"searches\s+(?:are|for|keep)|everywhere\s+right\s+now)\b", re.I)


def assess_account(author_id: str, handle: str, replies: list[dict[str, Any]],
                   recent_posts: list[dict[str, Any]], *, seed_id: str,
                   seed_text: str, timeline_status: str) -> dict[str, Any]:
    """Only an author's own, distinct original posts count toward account evidence."""
    own: dict[str, dict[str, Any]] = {}
    for post in [*replies, *recent_posts]:
        post_id = str(post.get("id") or post.get("id_str") or "")
        author = post.get("author") if isinstance(post.get("author"), dict) else {}
        if (not post_id or str(author.get("id") or author.get("id_str") or "") != author_id
                or is_repost(post) or post.get("quotedTweet") or post.get("quoted_tweet")):
            continue
        own.setdefault(post_id, post)
    bio = " ".join(_author_bio(post) for post in own.values())
    seller = bool(SELLER.search(bio) or any(SELLER.search(str(post.get("text") or "")) for post in own.values()))
    suspected_publisher = bool(PUBLISHER_BIO.search(bio) and sum(
        bool(PUBLISHER_POST.search(str(post.get("text") or ""))) for post in own.values()
    ) >= 3)
    pet_evidence: list[dict[str, str]] = []
    project_evidence: list[dict[str, str]] = []
    personal_project_evidence: list[dict[str, str]] = []
    for post_id, post in own.items():
        text = str(post.get("text") or "")
        fictional = bool(FICTION_FRAME.search(text) or FICTION_FRAME.search(bio))
        pet = PET.search(text) if not fictional else None
        project = next((match for clause in re.split(r"[.!?\n]", text)
                        for match in [PERSONAL_PROJECT.search(clause)]
                        if match and not HYPOTHETICAL.search(clause[:match.end()])), None) if not fictional else None
        home_project = next((match for clause in re.split(r"[.!?\n]", text)
                             for match in [HOME_PROJECT.search(clause)]
                             if match and not HYPOTHETICAL.search(clause[:match.end()])), None) if not fictional else None
        source = "reply" if any(str(r.get("id") or r.get("id_str")) == post_id for r in replies) else "recent"
        item = {"post_id": post_id, "source": source,
                "created_at": str(post.get("createdAt") or post.get("created_at") or ""),
                "text": text[:2000], "photo_urls": extract_post_photo_urls(post)}
        if pet:
            pet_evidence.append({**item, "quote": pet.group(0)})
        if project:
            evidence = {**item, "quote": project.group(0), "kind": "personal_project"}
            project_evidence.append(evidence)
            personal_project_evidence.append(evidence)
        elif home_project:
            project_evidence.append({**item, "quote": home_project.group(0), "kind": "own_home_scene"})
    independent = next(((pet, project) for pet in pet_evidence for project in personal_project_evidence
                        if pet["post_id"] != project["post_id"]), None)
    if seller:
        account_status = "excluded"
    elif independent:
        account_status = "potential"
    elif pet_evidence or project_evidence:
        account_status = "watch"
    else:
        account_status = "insufficient"
    if timeline_status != "complete" and account_status == "insufficient":
        account_status = "insufficient"
    entry_post = next((post for post in replies if str(post.get("inReplyToId") or "") == seed_id
                       and str(post.get("id") or post.get("id_str") or "") in own
                       and ENTRY.search(str(post.get("text") or ""))), None)
    nested = any(str(post.get("id") or post.get("id_str") or "") in own
                 and str(post.get("inReplyToId") or "") != seed_id for post in replies)
    if entry_post and PET_SENSITIVE.search(str(entry_post.get("text") or "")):
        entry_status = "hold"
    elif entry_post:
        entry_status = "ready"
    elif nested:
        entry_status = "context_pending"
    else:
        entry_status = "no_entry"
    if not entry_post and not nested:
        entry_post = next((post for post in recent_posts
                           if str(post.get("id") or post.get("id_str") or "") in own
                           and not post.get("isReply") and not post.get("inReplyToId")
                           and ENTRY.search(str(post.get("text") or ""))), None)
        if entry_post:
            entry_status = "hold" if PET_SENSITIVE.search(str(entry_post.get("text") or "")) else "ready"
    entry_id = str(entry_post.get("id") or entry_post.get("id_str") or "") if entry_post else None
    return {
        "authorId": author_id, "xHandle": handle or None, "accountStatus": account_status,
        "entryStatus": entry_status, "classifierVersion": VERSION,
        "accountEvidence": {
            "person_evidence": pet_evidence, "project_evidence": project_evidence,
            "exclusion_reason": "seller_or_reseller" if seller else None,
            "suspected_publisher": suspected_publisher,
            "suspected_publisher_evidence": "editorial_bio_and_multiple_guides" if suspected_publisher else None,
            "independent_behavior": bool(independent), "timeline_status": timeline_status,
            "shopping_intent": "unknown", "product_fit": "possible" if independent else "unknown",
            "same_product_need_resolved": any(RESOLVED.search(str(p.get("text") or "")) for p in own.values()),
            "verification": ["identity", "product_fit", "media_ownership", "location"],
            "own_post_ids": list(own),
            # Bounded text snapshots let an admin select a current entry without another paid API call.
            # The post remains context only; photo URLs do not prove ownership or product fit.
            "own_posts": [{"post_id": post_id, "author_id": author_id,
                            "created_at": str(post.get("createdAt") or post.get("created_at") or ""),
                            "text": str(post.get("text") or "")[:2000],
                            "source": "reply" if any(str(r.get("id") or r.get("id_str")) == post_id for r in replies) else "recent",
                            "direct_parent_status": "seed_is_direct_parent" if str(post.get("inReplyToId") or "") == seed_id else
                                "thread_context_known_direct_parent_unknown" if post.get("inReplyToId") else "own_recent_post",
                            "photo_urls": extract_post_photo_urls(post)}
                           for post_id, post in list(own.items())[:20]],
        },
        "entryEvidence": {
            "post_id": entry_id, "text": str(entry_post.get("text") or "")[:2000] if entry_post else None,
            "created_at": str(entry_post.get("createdAt") or entry_post.get("created_at") or "") if entry_post else None,
            "photo_urls": extract_post_photo_urls(entry_post) if entry_post else [],
            "quote": ENTRY.search(str(entry_post.get("text") or "")).group(0) if entry_post else None,
            "direct_parent_status": "seed_is_direct_parent" if entry_post and any(
                str(r.get("id") or r.get("id_str") or "") == entry_id for r in replies) else
                "own_recent_post" if entry_post else
                "thread_context_known_direct_parent_unknown" if nested else "no_entry",
            "seed_post_id": seed_id, "seed_text_context_only": seed_text[:500],
            "draft_ready": False, "human_approved": False, "contact_permission": False,
        },
    }
