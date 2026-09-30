from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator


SCHEMA = """
pragma journal_mode = wal;
pragma foreign_keys = on;
create table if not exists leads (
  id integer primary key autoincrement,
  post_id text not null unique,
  author_hash text not null,
  media_url text not null,
  media_sha256 text unique,
  post_url text,
  posted_at text,
  discovered_at text not null,
  status text not null default 'new',
  pet_type text,
  pet_count integer,
  clarity integer,
  print_fit integer,
  pet_confidence integer,
  engagement_quality integer,
  recency_score integer,
  account_quality integer,
  sensitive integer not null default 0,
  person_primary integer not null default 0,
  minor_primary integer not null default 0,
  score integer,
  analysis_json text,
  local_image_path text,
  mockup_json text,
  consent_copy text,
  public_copy text,
  dm_copy text,
  marketing_url text,
  campaign text,
  channel text,
  variant text,
  contacted_at text,
  created_at text not null
);
create table if not exists suppression (
  author_hash text primary key,
  reason text not null,
  created_at text not null
);
create table if not exists outreach (
  id integer primary key autoincrement,
  lead_id integer not null references leads(id) on delete cascade,
  channel text not null,
  variant text not null,
  final_copy text not null,
  mockup_path text,
  sent_at text not null
);
create index if not exists leads_review_idx on leads(status, score desc, discovered_at desc);
"""


class Database:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript(SCHEMA)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def list_leads(self, status: str | None = None) -> list[dict[str, Any]]:
        with self.connect() as connection:
            query = "select * from leads"
            values: tuple[Any, ...] = ()
            if status:
                query += " where status = ?"
                values = (status,)
            query += " order by coalesce(score, 0) desc, discovered_at desc limit 500"
            return [dict(row) for row in connection.execute(query, values)]

    def get_lead(self, lead_id: int) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute("select * from leads where id = ?", (lead_id,)).fetchone()
            return dict(row) if row else None

    def insert_lead(self, values: dict[str, Any]) -> int | None:
        now = datetime.now(timezone.utc).isoformat()
        payload = {"discovered_at": now, "created_at": now, **values}
        with self.connect() as connection:
            if connection.execute("select 1 from suppression where author_hash = ?", (payload["author_hash"],)).fetchone():
                return None
            columns = ",".join(payload)
            placeholders = ",".join("?" for _ in payload)
            try:
                cursor = connection.execute(
                    f"insert into leads ({columns}) values ({placeholders})",
                    tuple(payload.values()),
                )
                return int(cursor.lastrowid)
            except sqlite3.IntegrityError:
                return None

    def update_lead(self, lead_id: int, values: dict[str, Any]) -> None:
        if not values:
            return
        assignments = ",".join(f"{key} = ?" for key in values)
        with self.connect() as connection:
            connection.execute(
                f"update leads set {assignments} where id = ?",
                (*values.values(), lead_id),
            )

    def suppress(self, lead_id: int, reason: str) -> None:
        lead = self.get_lead(lead_id)
        if not lead:
            return
        with self.connect() as connection:
            connection.execute(
                "insert into suppression(author_hash,reason,created_at) values(?,?,?) on conflict(author_hash) do update set reason=excluded.reason",
                (lead["author_hash"], reason, datetime.now(timezone.utc).isoformat()),
            )
            connection.execute("update leads set status = 'suppressed' where author_hash = ?", (lead["author_hash"],))

    def cleanup_paths(self, days: int = 7) -> list[str]:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        with self.connect() as connection:
            rows = connection.execute(
                "select local_image_path,mockup_json from leads where discovered_at < ? and (local_image_path is not null or mockup_json is not null)",
                (cutoff,),
            ).fetchall()
            paths: list[str] = []
            for row in rows:
                if row["local_image_path"]:
                    paths.append(row["local_image_path"])
                if row["mockup_json"]:
                    paths.extend(json.loads(row["mockup_json"]))
            connection.execute(
                "update leads set media_url = '', local_image_path = null, mockup_json = null where discovered_at < ?",
                (cutoff,),
            )
            return paths
