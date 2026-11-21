"""Archive-first, five-page search plus real-thread participant experiment."""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import time
import uuid
from typing import Any

import httpx

from lead_studio.config import Settings, TWITTERAPI_ARCHIVE_DIR
from lead_studio.engagement_profiles import assess_engagement_post, finalize_draft_gate
from lead_studio.engagement_semantics import review_photo, review_text
from lead_studio.twitterapi import _iso_datetime
from probe_consumer_recall import _contact_match, is_repost
from probe_purchase_recall import (CREDITS_PATH, SEARCH_PATH, RecallProbeError,
                                   _author_bio, _author_id, _credits, _save,
                                   extract_post_photo_urls, historical_ids)

VERSION = "consumer-engagement-v1"
REPLIES_PATH = "/twitter/tweet/replies"
SEED_QUERIES = (
    ("pet_photo_invite_seed", '("show me" OR "show us" OR "drop") (pet OR pets OR dog OR dogs OR cat OR cats) min_replies:1 -filter:replies lang:en'),
    ("pet_art_discussion_seed", '("pet portrait" OR "dog portrait" OR "cat portrait" OR "photo pillow") min_replies:1 -filter:replies lang:en'),
    ("personal_make", '("I drew my" OR "I painted my" OR "I made this") (dog OR cat OR pet OR pillow OR portrait) -filter:replies lang:en'),
)
MAX_PAID_PAGES = 5  # 3 search + 2 reply pages, each documented <=20 tweets.
PAGE_CREDIT_RESERVE = 300  # 20 returned tweets * 15 credits; no paid profile/parent fetch.
INVITE = re.compile(r"\b(?:show\s+(?:me|us)|drop|share|post)\b.{0,90}\b(?:your|yr)\s+(?:pet|pets|dog|dogs|cat|cats|pet\s+photo|dog\s+photo|cat\s+photo)\b", re.I)
ART_DISCUSSION = re.compile(r"\b(?:pet|dog|cat)\s+(?:portrait|art|photo)|\bphoto\s+pillow\b", re.I)
DISCUSSION = re.compile(r"\?|\b(?:thoughts|which|show|share|made|drew|painted|design)\b", re.I)
SEED_AD = re.compile(r"\b(?:shop now|order now|buy now|commissions? open|dm to order|limited sale|giveaway|airdrop|nft)\b", re.I)
SEED_SENSITIVE = re.compile(r"\b(?:passed away|died|rip|terminal|very sick|put (?:him|her|them) to sleep)\b", re.I)


def _eligible_seed(post: dict[str, Any], kind: str) -> bool:
    text = str(post.get("text") or "")
    if SEED_AD.search(text) or SEED_SENSITIVE.search(text):
        return False
    if kind == "pet_photo_invite_seed":
        return bool(INVITE.search(text))
    return bool(ART_DISCUSSION.search(text) and DISCUSSION.search(text))


def _post_time(post: dict[str, Any], since: int, until: int) -> str | None:
    value = _iso_datetime(post.get("createdAt") or post.get("created_at"))
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None or not since <= parsed.timestamp() <= until:
        return None
    return value


async def run_engagement_recall_probe(
    client: httpx.AsyncClient, settings: Settings, *, contacted_snapshot: dict[str, Any],
    archive_dir: Path = TWITTERAPI_ARCHIVE_DIR, now: datetime | None = None,
    min_balance_credits: int = 3000, max_total_credits: int = 1800,
    resume_from: Path | None = None,
) -> dict[str, Any]:
    if not settings.twitterapi_api_key:
        raise RuntimeError("TWITTERAPI_API_KEY is missing")
    if max_total_credits != 1800 or min_balance_credits < 3000:
        raise ValueError("Engagement probe uses a fixed 1800-credit hard bound")
    if not isinstance(contacted_snapshot, dict) or not contacted_snapshot.get("snapshot_at") or not all(
        isinstance(contacted_snapshot.get(key), (list, set)) for key in ("post_ids", "author_ids", "handles")
    ):
        raise ValueError("Complete contacted snapshot required before paid search")
    snapshot = {"post_ids": set(map(str, contacted_snapshot["post_ids"])),
                "author_ids": set(map(str, contacted_snapshot["author_ids"])),
                "handles": {str(v).lower().lstrip("@") for v in contacted_snapshot["handles"]}}
    prior: dict[str, Any] | None = None
    if resume_from is not None:
        if (not re.fullmatch(r"engagement-recall-[0-9TZa-f-]+\.json", resume_from.name)
                or resume_from.resolve().parent != archive_dir.resolve()):
            raise ValueError("Resume archive must be a local engagement archive")
        prior = json.loads(resume_from.read_text(encoding="utf-8"))
        old_queries = prior.get("queries") or []
        if (prior.get("kind") != "query_only_engagement_recall"
                or prior.get("status") != "stopped_provider_error"
                or len(old_queries) != 2
                or old_queries[0].get("name") != SEED_QUERIES[0][0]
                or old_queries[0].get("role") != "seed"
                or len(old_queries[0].get("pages") or []) != 1
                or old_queries[0]["pages"][0].get("http_status") != 200
                or old_queries[1].get("name") != SEED_QUERIES[1][0]
                or len(old_queries[1].get("pages") or []) != 1
                or old_queries[1]["pages"][0].get("http_status") != 503
                or not isinstance(prior.get("credits_before"), dict)
                or prior.get("configuration", {}).get("maxTotalCredits") != 1800):
            raise ValueError("Only the exact one-success, one-503 archive can be resumed")
        if any(json.loads(p.read_text(encoding="utf-8")).get("resume_of") == prior.get("archive_id")
               for p in archive_dir.glob("engagement-recall-*.json") if p != resume_from):
            raise ValueError("This partial archive has already been resumed")
    started = (datetime.fromisoformat(prior["started_at"]) if prior else
               (now or datetime.now(timezone.utc))).astimezone(timezone.utc)
    since = int((started - timedelta(days=3)).timestamp())
    until = int(started.timestamp())
    query_fingerprint = sha256(json.dumps({"version": VERSION, "queries": SEED_QUERIES},
                                         sort_keys=True).encode("utf-8")).hexdigest()
    if prior:
        for index, (_, expression) in enumerate(SEED_QUERIES[:2]):
            expected = f"{expression} since_time:{since} until_time:{until}"
            actual = prior["queries"][index]["pages"][0]["request_params"].get("query")
            if actual != expected:
                raise ValueError("Resume query or time window differs from the frozen original")
    historical_posts, historical_authors, archive_count = historical_ids(archive_dir)
    archive_id = f"engagement-recall-{started:%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}"
    path = archive_dir / f"{archive_id}.json"
    document: dict[str, Any] = {
        "archive_version": 1, "kind": "query_only_engagement_recall", "archive_id": archive_id,
        "started_at": started.isoformat(), "status": "collecting", "queries": [],
        "configuration": {"lookbackDays": 3, "searchPages": 3, "maxReplyPages": 2,
                          "maxPaidPages": MAX_PAID_PAGES, "maxTotalCredits": max_total_credits,
                          "strictImport": False, "outreach": False,
                          "queryFingerprint": query_fingerprint},
        "baseline_archives": archive_count, "baseline_post_ids": len(historical_posts),
        "baseline_author_ids": len(historical_authors),
        "contacted_snapshot": {"snapshot_at": contacted_snapshot["snapshot_at"],
                               **{key: len(snapshot[key]) for key in snapshot}},
    }
    if prior:
        first = deepcopy(prior["queries"][0])
        first["role"] = "reused"  # audited here, never reimported with a new source job
        first["reused_from"] = prior["archive_id"]
        document["queries"].append(first)
        document["resume_of"] = prior["archive_id"]
        document["resume_source_path"] = str(resume_from)
        document["prior_attempts_reserved_credits"] = 2 * PAGE_CREDIT_RESERVE
        document["baseline_archives"] = prior["baseline_archives"]
        document["baseline_post_ids"] = prior["baseline_post_ids"]
        document["baseline_author_ids"] = prior["baseline_author_ids"]
    _save(path, document)
    try:
        before = await _credits(client, settings)
    except Exception as error:
        document.update(status="failed_credit_check", error_type=type(error).__name__)
        _save(path, document)
        raise RecallProbeError(path, error) from error
    current = before
    if prior:
        document["credits_at_resume"] = current
        before = prior["credits_before"]
    document["credits_before"] = before
    _save(path, document)
    seen_posts: set[str] = set()
    seen_authors: set[str] = set()
    author_by_group: dict[str, set[str]] = {key: set() for key in
                                            ("pet_share", "thread_participant", "personal_make")}
    tier_counts: Counter[str] = Counter()
    candidate_decisions: list[tuple[dict[str, Any], dict[str, Any], str, str]] = []
    seed_posts: dict[str, list[dict[str, Any]]] = {name: [] for name, _ in SEED_QUERIES[:2]}
    selected_seed_authors: set[str] = set()
    pages_used = 2 if prior else 0
    resume_pages = 0
    reused_post_ids = 0
    if prior:
        first_query = document["queries"][0]
        first_posts = {str(p.get("id") or p.get("id_str")): p
                       for p in first_query["pages"][0]["response"].get("tweets", [])
                       if isinstance(p, dict)}
        for post in first_posts.values():
            if (_post_time(post, since, until) and not is_repost(post)
                    and not post.get("isReply") and not post.get("inReplyToId")
                    and int(post.get("replyCount") or 0) > 0
                    and _eligible_seed(post, SEED_QUERIES[0][0])):
                seed_posts[SEED_QUERIES[0][0]].append(post)
        for decision in first_query["decisions"]:
            if not isinstance(decision, dict) or "intent" not in decision:
                continue
            seen_posts.add(str(decision["post_id"]))
            author = str(decision.get("author_id") or "")
            if author:
                seen_authors.add(author)
                author_by_group["thread_participant"].add(author)
            tier_counts[decision["intent"]["tier"]] += 1
            post = first_posts.get(str(decision["post_id"]))
            if decision["intent"]["tier"] == "exploratory" and post:
                candidate_decisions.append((decision, post, _author_bio(post), ""))
        reused_post_ids = len(seen_posts)

    async def one_page(name: str, role: str, endpoint: str, params: dict[str, str],
                       source: str, seed: dict[str, Any] | None = None) -> None:
        nonlocal current, pages_used, resume_pages
        if (pages_used >= (MAX_PAID_PAGES + (1 if prior else 0)) or
                (pages_used + 1) * PAGE_CREDIT_RESERVE > max_total_credits):
            document["status"] = "stopped_static_spend_bound"
            return
        if sum(current.values()) - PAGE_CREDIT_RESERVE < min_balance_credits or sum(before.values()) - sum(current.values()) + PAGE_CREDIT_RESERVE > max_total_credits:
            document["status"] = "stopped_credit_reserve"
            return
        entry: dict[str, Any] = {"name": name, "role": role, "query": params.get("query"),
                                 "seed_post_id": str(seed.get("id") or "") if seed else None,
                                 "seed_text": str(seed.get("text") or "")[:1000] if seed else None,
                                 "pages": [], "decisions": [], "counts": {"raw_rows": 0,
                                   "new_post_ids": 0, "new_authors": 0, "prior_authors": 0,
                                   "out_of_window_or_invalid": 0, "contacted_excluded": 0}}
        document["queries"].append(entry)
        _save(path, document)
        response = await client.get(f"{settings.twitterapi_base_url}{endpoint}",
                                    headers={"X-API-Key": settings.twitterapi_api_key}, params=params)
        try:
            payload = response.json()
        except ValueError:
            payload = {"invalid_json": True}
        entry["pages"].append({"requested_at": datetime.now(timezone.utc).isoformat(),
                               "endpoint": endpoint, "request_params": params,
                               "http_status": response.status_code,
                               "business_status": payload.get("status") if isinstance(payload, dict) else None,
                               "response": payload})
        pages_used += 1
        resume_pages += 1
        _save(path, document)  # save the full paid response before examining any post
        if (not 200 <= response.status_code < 300 or not isinstance(payload, dict)
                or str(payload.get("status") or "").lower() == "error"):
            document["status"] = "stopped_provider_error"
            return
        posts = payload.get("tweets")
        if not isinstance(posts, list) or len(posts) > 20:
            document["status"] = "stopped_invalid_payload"
            return
        entry["counts"]["raw_rows"] = len(posts)
        for post in posts:
            if not isinstance(post, dict):
                continue
            post_id = str(post.get("id") or post.get("id_str") or "")
            posted_at = _post_time(post, since, until)
            if role == "seed":
                if (post_id and posted_at and not is_repost(post)
                        and not post.get("isReply") and not post.get("inReplyToId")
                        and int(post.get("replyCount") or 0) > 0
                        and _eligible_seed(post, name)):
                    seed_posts[name].append(post)
                continue  # seed authors are context, never candidate accounts
            if not post_id or post_id in historical_posts or post_id in seen_posts:
                continue
            seen_posts.add(post_id)
            entry["counts"]["new_post_ids"] += 1
            if not posted_at:
                entry["counts"]["out_of_window_or_invalid"] += 1
                entry["decisions"].append({"post_id": post_id, "reason": "invalid_or_out_of_window"})
                continue
            author = _author_id(post)
            if seed and author in selected_seed_authors:
                entry["decisions"].append({"post_id": post_id, "reason": "seed_author_not_participant"})
                continue
            seed_group_count = sum(1 for d in entry["decisions"] if d.get("author_id") and d.get("intent"))
            if not author or author in seen_authors or len(author_by_group[source]) >= 20 or (seed and seed_group_count >= 10):
                entry["decisions"].append({"post_id": post_id, "reason": "duplicate_or_group_limit"})
                continue
            seen_authors.add(author)
            author_by_group[source].add(author)
            entry["counts"]["new_authors"] += 1
            if author in historical_authors:
                entry["counts"]["prior_authors"] += 1
            seed_text = str(seed.get("text") or "") if seed else ""
            direct_parent = bool(seed and str(post.get("inReplyToId") or "") == str(seed.get("id")))
            intent = assess_engagement_post(str(post.get("text") or ""), bio=_author_bio(post),
                                            source=source, seed_text=seed_text,
                                            direct_parent=direct_parent, is_repost=is_repost(post),
                                            verified_pet_invitation=bool(seed and name == "thread_participant_1"),
                                            own_photo_count=len(extract_post_photo_urls(post)))
            if _contact_match(post, snapshot):
                intent.update(tier="excluded", persona=None, priority="none",
                              exclusion_reasons=[*intent["exclusion_reasons"], "previously_contacted"],
                              contact_status="known_contacted")
                entry["counts"]["contacted_excluded"] += 1
            else:
                intent["contact_status"] = "not_seen_in_snapshot"
            tier_counts[intent["tier"]] += 1
            decision = {"post_id": post_id, "author_id": author, "posted_at": posted_at,
                        "source_stage": name,
                        "in_reply_to_id": str(post.get("inReplyToId") or "") or None,
                        "seed_post_id": str(seed.get("id")) if seed else None,
                        "intent": intent}
            entry["decisions"].append(decision)
            if intent["tier"] == "exploratory":
                candidate_decisions.append((decision, post, _author_bio(post), seed_text))
        _save(path, document)
        current = await _credits(client, settings)
        document["credits_after_page"] = current
        _save(path, document)

    try:
        if sum(before.values()) < min_balance_credits + max_total_credits:
            document["status"] = "stopped_low_initial_balance"
        for name, expression in SEED_QUERIES:
            if document["status"] != "collecting":
                break
            if prior and name == SEED_QUERIES[0][0]:
                continue
            params = {"query": f"{expression} since_time:{since} until_time:{until}",
                      "queryType": "Latest", "cursor": ""}
            await one_page(name, "seed" if name != "personal_make" else "candidate",
                           SEARCH_PATH, params, name)
        selected_seeds: list[tuple[str, dict[str, Any]]] = []
        for seed_kind, _ in SEED_QUERIES[:2]:
            if document["status"] != "collecting":
                break
            seed = next((p for p in sorted(seed_posts[seed_kind], key=lambda p: -int(p.get("replyCount") or 0))
                         if _author_id(p) and _author_id(p) not in selected_seed_authors), None)
            if seed is None:
                continue
            selected_seed_authors.add(_author_id(seed))
            selected_seeds.append((seed_kind, seed))
        # A seed is context only, even if its author also appeared in the
        # independent works search before seed selection was finalized.
        retained_candidates = []
        for item in candidate_decisions:
            decision = item[0]
            if decision.get("author_id") in selected_seed_authors:
                intent = decision["intent"]
                intent.update(tier="excluded", persona=None, priority="none",
                              exclusion_reasons=[*intent["exclusion_reasons"], "seed_author_context_only"],
                              draft_ready=False)
                tier_counts["exploratory"] -= 1
                tier_counts["excluded"] += 1
            else:
                retained_candidates.append(item)
        candidate_decisions = retained_candidates
        for seed_kind, seed in selected_seeds:
            if document["status"] != "collecting":
                break
            stage = "thread_participant_1" if seed_kind == SEED_QUERIES[0][0] else "thread_participant_2"
            await one_page(stage, "participant",
                           REPLIES_PATH, {"tweetId": str(seed["id"]), "sinceTime": str(since),
                                          "untilTime": str(until), "cursor": ""},
                           "thread_participant", seed)
        # Local inference has no provider requests. It is optional, bounded, and never
        # upgrades a raw review to strict lead or proof of image ownership.
        if document["status"] == "collecting":
            quotas = {"thread_participant_1": 3, "thread_participant_2": 3,
                      "personal_make": 4}
            selected_for_review: list[tuple[dict[str, Any], dict[str, Any], str, str]] = []
            selected_ids: set[str] = set()
            for item in candidate_decisions:
                stage = item[0].get("source_stage", "personal_make")
                if quotas.get(stage, 0) > 0:
                    selected_for_review.append(item)
                    selected_ids.add(str(item[0]["post_id"]))
                    quotas[stage] -= 1
            # If exactly one seed has participants, its otherwise unused three slots
            # can review more of that seed; never borrow slots from works.
            populated = [stage for stage in ("thread_participant_1", "thread_participant_2")
                         if any(item[0].get("source_stage") == stage for item in candidate_decisions)]
            if len(populated) == 1:
                for item in candidate_decisions:
                    if len([v for v in selected_for_review if v[0].get("source_stage") == populated[0]]) >= 6:
                        break
                    if item[0].get("source_stage") == populated[0] and str(item[0]["post_id"]) not in selected_ids:
                        selected_for_review.append(item)
                        selected_ids.add(str(item[0]["post_id"]))
            model_deadline = time.monotonic() + 240
            for decision, post, bio, seed_text in selected_for_review:
                if time.monotonic() >= model_deadline:
                    break  # remaining rows stay explicitly pending
                old_tier = decision["intent"]["tier"]
                decision["intent"] = await review_text(client, settings, decision["intent"],
                                                        str(post.get("text") or ""), bio, seed_text)
                if decision["intent"]["tier"] != old_tier:
                    tier_counts[old_tier] -= 1
                    tier_counts[decision["intent"]["tier"]] += 1
                photos = extract_post_photo_urls(post)
                if photos:
                    decision["intent"]["media_review"] = await review_photo(client, settings, photos[0])
                    decision["intent"]["media_semantic_status"] = decision["intent"]["media_review"]["status"]
                decision["intent"] = finalize_draft_gate(decision["intent"],
                    media_review=decision["intent"].get("media_review"))
                _save(path, document)
            document["status"] = "completed"
    except Exception as error:
        document.update(status="failed", error_type=type(error).__name__)
        raise RecallProbeError(path, error) from error
    finally:
        document["completed_at"] = datetime.now(timezone.utc).isoformat()
        document["credits_after"] = current
        selected = [d for q in document["queries"] for d in q["decisions"]
                    if d.get("intent", {}).get("tier") == "exploratory"]
        document["summary"] = {
            "archive_id": archive_id, "archive_path": str(path), "status": document["status"],
            "search_pages": pages_used, "new_request_pages": resume_pages,
            "reused_success_pages": 1 if prior else 0,
            "seed_search_pages": sum(q["role"] in {"candidate", "seed"} for q in document["queries"]),
            "thread_reply_pages": sum(q["role"] == "participant" for q in document["queries"]),
            "retrieved_new_posts": len(seen_posts), "unique_new_authors": len(seen_authors),
            "reused_post_ids": reused_post_ids,
            "resume_new_posts": len(seen_posts) - reused_post_ids,
            "prior_archive_authors": sum(q["counts"]["prior_authors"] for q in document["queries"]),
            "group_authors": {key: len(value) for key, value in author_by_group.items()},
            "text_tiers": dict(tier_counts), "review_pool_posts": len(selected),
            "draft_ready_posts": sum(d["intent"].get("draft_ready") is True for d in selected),
            "stages": [{"name": q["name"], "role": q["role"], **q["counts"]} for q in document["queries"]],
            "strict_qualified": 0, "scope": "raw_review_only", "provider": "twitterapi",
            "credits_before": before, "credits_after": current,
            "observed_credits_used": sum(before.values()) - sum(current.values()),
            "credit_settlement_pending": before == current,
            "max_static_provider_cost": pages_used * PAGE_CREDIT_RESERVE,
        }
        _save(path, document)
    return document["summary"]
