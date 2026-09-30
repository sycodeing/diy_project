import json
from datetime import datetime, timedelta, timezone

from lead_studio.db import Database


def test_dedup_and_permanent_suppression(tmp_path):
    db = Database(tmp_path / "test.sqlite3")
    lead_id = db.insert_lead({"post_id": "1", "author_hash": "a" * 64, "media_url": "https://example.com/a.jpg"})
    assert lead_id
    assert db.insert_lead({"post_id": "1", "author_hash": "b" * 64, "media_url": "https://example.com/b.jpg"}) is None
    db.suppress(lead_id, "opt_out")
    assert db.insert_lead({"post_id": "2", "author_hash": "a" * 64, "media_url": "https://example.com/c.jpg"}) is None


def test_retention_clears_media_but_keeps_metadata(tmp_path):
    db = Database(tmp_path / "test.sqlite3")
    old = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
    lead_id = db.insert_lead({"post_id": "1", "author_hash": "a" * 64, "media_url": "https://example.com/a.jpg", "discovered_at": old})
    db.update_lead(lead_id, {"local_image_path": "a.jpg", "mockup_json": json.dumps(["b.webp"])})
    assert db.cleanup_paths() == ["a.jpg", "b.webp"]
    lead = db.get_lead(lead_id)
    assert lead["media_url"] == ""
    assert lead["post_id"] == "1"
