"""Replay archived raw-post photo metadata into a local media-only JSON file.

No database, provider, vision, or outreach calls are made. The output contains
only post_id and photo_urls; a separate reviewed step applies it remotely.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from lead_studio.config import TWITTERAPI_ARCHIVE_DIR
from probe_purchase_recall import extract_raw_reviews


ARCHIVES = (
    "recall-diagnostic-20261118T072710Z-3688ae49.json",
    "purchase-recall-20261118T073406Z-1b194044.json",
    "purchase-recall-parent-2122672037684486452-5d3c0f6a.json",
    "purchase-recall-20261118T081021Z-beb9a2b4.json",
)


def prepare_media_backfill(archive_dir: Path) -> list[dict[str, object]]:
    paths = [archive_dir / name for name in ARCHIVES]
    missing = [str(path) for path in paths if not path.is_file()]
    if missing:
        raise FileNotFoundError("Missing raw archive evidence: " + ", ".join(missing))
    reviews = extract_raw_reviews(paths)
    rows = [{"post_id": row["postId"], "photo_urls": row["photoUrls"]}
            for row in reviews]
    if len(rows) != 41 or len({row["post_id"] for row in rows}) != 41:
        raise RuntimeError(f"Expected exactly 41 distinct archived posts, found {len(rows)}")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive-dir", type=Path, default=TWITTERAPI_ARCHIVE_DIR)
    parser.add_argument("--write-json", action="store_true", help="Write local media-only JSON for review")
    parser.add_argument("--output", type=Path, default=Path(".data/raw-review-photo-backfill.json"))
    args = parser.parse_args()
    rows = prepare_media_backfill(args.archive_dir)
    summary = {
        "scope": "local_media_only_no_remote_write",
        "posts": len(rows), "posts_with_photo": sum(bool(row["photo_urls"]) for row in rows),
        "photos": sum(len(row["photo_urls"]) for row in rows),
    }
    if args.write_json:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps({"rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
        summary["output"] = str(args.output.resolve())
    else:
        summary["output"] = "dry_run_only"
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
