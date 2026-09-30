from __future__ import annotations

import json
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any, AsyncIterator

from .credentials import load_cookie


ITERATOR_OPERATIONS = {
    "search", "search_user", "tweet_replies", "tweet_thread", "followers",
    "verified_followers", "following", "subscriptions", "retweeters",
    "user_tweets", "user_tweets_and_replies", "user_media", "list_timeline",
    "trends", "search_trend", "bookmarks", "list_members", "community_members",
    "community_moderators", "community_tweets",
}
SINGLE_OPERATIONS = {
    "user_by_id", "user_by_login", "user_about", "tweet_details", "community_info",
}
READ_ONLY_OPERATIONS = ITERATOR_OPERATIONS | SINGLE_OPERATIONS


@asynccontextmanager
async def client(cookie_path: Path):
    from twscrape import API
    from twscrape.account import Account
    from twscrape.accounts_pool import AccountsPool, NoAccountError
    from twscrape.utils import parse_cookies

    cookie = load_cookie(cookie_path)
    parsed = parse_cookies(cookie)
    if not parsed.get("auth_token") or not parsed.get("ct0"):
        raise ValueError("Cookie must contain auth_token and ct0.")

    class MemoryAccountPool(AccountsPool):
        def __init__(self):
            self.account = Account(
                username="brand-account", password="_", email="_", email_password="_",
                user_agent="@chrome", active=True, cookies=parsed,
            )

        async def get_for_queue_or_wait(self, queue: str):
            locked_until = self.account.locks.get(queue)
            if not self.account.active or (locked_until and locked_until > datetime.now(timezone.utc)):
                raise NoAccountError(f"No account available for queue {queue}")
            return self.account

        async def lock_until(self, username: str, queue: str, unlock_at: int, req_count=0):
            self.account.locks[queue] = datetime.fromtimestamp(unlock_at, timezone.utc)
            self.account.stats[queue] = self.account.stats.get(queue, 0) + req_count

        async def unlock(self, username: str, queue: str, req_count=0):
            self.account.locks.pop(queue, None)
            self.account.stats[queue] = self.account.stats.get(queue, 0) + req_count

        async def mark_inactive(self, username: str, error_msg: str | None):
            self.account.active = False
            self.account.error_msg = error_msg

    yield API(MemoryAccountPool(), raise_when_no_account=True)


async def read(operation: str, arguments: dict[str, Any], limit: int, cookie_path: Path) -> list[dict[str, Any]]:
    if operation not in READ_ONLY_OPERATIONS:
        raise ValueError("Only allowlisted read-only X operations are available.")
    safe_limit = max(1, min(limit, 100))
    arguments = _normalize_arguments(operation, arguments)
    async with client(cookie_path) as api:
        method = getattr(api, operation)
        if operation in ITERATOR_OPERATIONS:
            iterator = method(**arguments, limit=safe_limit)
            return [_serialize(item) async for item in iterator]
        result = await method(**arguments)
        return [] if result is None else [_serialize(result)]


def _normalize_arguments(operation: str, arguments: dict[str, Any]) -> dict[str, Any]:
    allowed: dict[str, set[str]] = {
        "search": {"q", "kv"}, "search_user": {"q", "kv"}, "search_trend": {"q", "kv"},
        "user_by_id": {"uid", "kv"}, "user_by_login": {"login", "kv"}, "user_about": {"username", "kv"},
        "tweet_details": {"twid", "kv"}, "tweet_replies": {"twid", "kv"}, "tweet_thread": {"twid", "kv"},
        "followers": {"uid", "kv"}, "verified_followers": {"uid", "kv"}, "following": {"uid", "kv"},
        "subscriptions": {"uid", "kv"}, "retweeters": {"twid", "kv"}, "user_tweets": {"uid", "kv"},
        "user_tweets_and_replies": {"uid", "kv"}, "user_media": {"uid", "kv"},
        "list_timeline": {"list_id", "kv"}, "list_members": {"list_id", "kv"},
        "trends": {"trend_id", "kv"}, "bookmarks": {"kv"},
        "community_members": {"community_id", "kv"}, "community_moderators": {"community_id", "kv"},
        "community_tweets": {"community_id", "kv"}, "community_info": {"community_id", "kv"},
    }
    extra = set(arguments) - allowed[operation]
    if extra:
        raise ValueError(f"Unsupported arguments: {', '.join(sorted(extra))}")
    normalized = dict(arguments)
    for key in ("uid", "twid", "list_id", "community_id"):
        if key in normalized:
            normalized[key] = int(normalized[key])
    return normalized


def _serialize(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if hasattr(value, "dict"):
        return value.dict()
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, dict):
        return value
    return json.loads(json.dumps(value, default=str))
