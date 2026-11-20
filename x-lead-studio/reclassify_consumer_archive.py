"""Offline reclassification of one archived consumer search; never refetch or import."""
from __future__ import annotations

from collections import Counter
import json
from pathlib import Path
import sys

from lead_studio.consumer_profiles import assess_consumer_profile
from probe_consumer_recall import is_repost
from probe_purchase_recall import _author_bio


def reclassify_archive(source: Path, destination: Path) -> dict:
    document = json.loads(source.read_text(encoding="utf-8"))
    if document.get("kind") != "query_only_consumer_recall":
        raise ValueError("Expected consumer recall archive")
    rows: list[dict] = []
    old_counts: Counter[str] = Counter()
    new_counts: Counter[str] = Counter()
    authors: dict[str, set[str]] = {}
    for query in document.get("queries", []):
        old_by_id = {str(decision.get("post_id")): decision.get("intent")
                     for decision in query.get("decisions", [])
                     if isinstance(decision, dict) and isinstance(decision.get("intent"), dict)}
        for page in query.get("pages", []):
            for post in (page.get("response") or {}).get("tweets") or []:
                if not isinstance(post, dict):
                    continue
                post_id = str(post.get("id") or post.get("id_str") or "")
                old = old_by_id.get(post_id)
                if old is None:
                    continue  # Keep the original window/dedupe/contacted decision.
                new = assess_consumer_profile(str(post.get("text") or ""),
                                              author_bio=_author_bio(post), is_repost=is_repost(post))
                if old.get("contact_status") == "known_contacted":
                    new.update(tier="excluded", persona=None, priority="none",
                               exclusion_reasons=["previously_contacted"])
                new["contact_status"] = old.get("contact_status", "unknown")
                new["previous_classification"] = {
                    "version": old.get("version"), "tier": old.get("tier"),
                    "persona": old.get("persona"), "priority": old.get("priority"),
                    "product_fit": old.get("product_fit"),
                    "exclusion_reasons": old.get("exclusion_reasons"),
                }
                old_counts[str(old.get("persona") or "excluded")] += 1
                new_counts[str(new.get("persona") or "excluded")] += 1
                author = post.get("author") if isinstance(post.get("author"), dict) else {}
                author_id = str(author.get("id") or author.get("id_str") or
                                author.get("userName") or post_id)
                if new["persona"]:
                    authors.setdefault(new["persona"], set()).add(author_id)
                rows.append({"post_id": post_id, "author_id": author_id,
                             "source_archive": source.name, "source_stage": query.get("name"),
                             "prior_intent": old, "new_intent": new})
    result = {"source_archive": source.name, "source_kind": document["kind"],
              "old_counts": dict(old_counts), "new_counts": dict(new_counts),
              "new_persona_authors": {key: len(value) for key, value in authors.items()},
              "rows": rows, "remote_applied": False}
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: reclassify_consumer_archive.py SOURCE DESTINATION")
    summary = reclassify_archive(Path(sys.argv[1]), Path(sys.argv[2]))
    print(json.dumps({key: summary[key] for key in ("source_archive", "old_counts",
                                                    "new_counts", "new_persona_authors")},
                     ensure_ascii=False))
