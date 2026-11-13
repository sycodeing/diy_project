"""Replay explicit raw archives without network, DB writes or watermark changes."""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path

from lead_studio.purchase_intent import assess_purchase_intent, VERSION


def audit(paths: list[Path]) -> dict:
    posts = {}
    for path in paths:
        archive = json.loads(path.read_text(encoding="utf-8"))
        for query in archive.get("queries", []):
            for page in query.get("pages", []):
                for post in page.get("response", {}).get("tweets", []):
                    post_id = str(post.get("id") or post.get("id_str") or "")
                    if post_id:
                        posts[post_id] = post
    tiers = Counter()
    reasons = Counter()
    matched = []
    for post_id, post in posts.items():
        result = assess_purchase_intent(str(post.get("text") or post.get("full_text") or ""))
        tiers[result["tier"]] += 1
        reasons.update(result["exclusion_reasons"])
        if result["tier"] != "excluded":
            matched.append({"post_id": post_id, **result})
    return {"version": VERSION, "archives": len(paths), "unique_posts": len(posts),
        "tiers": dict(tiers), "exclusion_reasons": dict(reasons), "matched": matched,
        "note": "Text-only offline diagnostic, not a location/image-qualified batch or live query yield."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archives", nargs="+", type=Path)
    args = parser.parse_args()
    print(json.dumps(audit(args.archives), ensure_ascii=False, indent=2))
