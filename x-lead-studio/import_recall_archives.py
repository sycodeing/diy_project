"""Prepare or upload the 36 archived shopping-query posts as raw reviews only.

Default is local dry-run. Upload requires --execute-upload after the SQL
migration and web deployment; it never imports control posts or strict leads.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import httpx

from lead_studio.config import Settings, TWITTERAPI_ARCHIVE_DIR
from probe_purchase_recall import extract_raw_reviews


ARCHIVES = (
    "recall-diagnostic-20261118T072710Z-3688ae49.json",
    "purchase-recall-20261118T073406Z-1b194044.json",
    "purchase-recall-parent-2122672037684486452-5d3c0f6a.json",
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute-upload", action="store_true")
    parser.add_argument("--archive-dir", type=Path, default=TWITTERAPI_ARCHIVE_DIR)
    args = parser.parse_args()
    paths = [args.archive_dir / name for name in ARCHIVES]
    missing = [str(path) for path in paths if not path.is_file()]
    if missing:
        parser.error("Missing archived evidence: " + ", ".join(missing))
    rows = extract_raw_reviews(paths)
    stages: dict[str, int] = {}
    for row in rows:
        stages[row["sourceStage"]] = stages.get(row["sourceStage"], 0) + 1
    summary = {
        "scope": "raw_review_only_not_x_leads_or_outreach",
        "distinct_posts": len(rows),
        "distinct_authors": len({row["authorId"] for row in rows if row["authorId"]}),
        "source_stages": stages,
        "control_posts_imported": 0,
        "resolved_parent_mismatch": sum(row["parentStatus"] == "resolved_product_mismatch" for row in rows),
    }
    if len(rows) != 36:
        raise RuntimeError(f"Expected exactly 36 shopping posts, found {len(rows)}; upload aborted")
    if args.execute_upload:
        settings = Settings()
        if len(settings.x_lead_worker_secret) < 32:
            raise RuntimeError("Worker secret is not configured")
        response = httpx.post(
            f"{settings.diy_site_url}/api/x-leads/worker/raw-reviews/import",
            headers={"Authorization": f"Bearer {settings.x_lead_worker_secret}"},
            json={"rawCandidates": rows}, timeout=120,
        )
        response.raise_for_status()
        summary["upload"] = response.json()
    else:
        summary["upload"] = "dry_run"
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
