from __future__ import annotations

import json
import asyncio

from lead_studio.xuse_client import configured_account_keys, send_approved_action, send_approved_reply, xuse_is_installed


def test_configured_accounts_require_active_local_cookie_file(tmp_path):
    config = tmp_path / "config"
    config.mkdir()
    cookie = config / "first.cookies.json"
    cookie.write_text("[]", encoding="utf-8")
    (config / "accounts.json").write_text(json.dumps([
        {"account_id": "first", "is_active": True, "cookie_file_path": "first.cookies.json"},
        {"account_id": "inactive", "is_active": False, "cookies": [{"name": "auth_token"}]},
        {"account_id": "missing", "is_active": True, "cookie_file_path": "missing.json"},
    ]), encoding="utf-8")

    assert configured_account_keys(tmp_path) == ["first"]


def test_unconfigured_account_fails_before_browser_start(tmp_path):
    result = asyncio.run(send_approved_reply(
        x_use_home=tmp_path,
        account="not-configured",
        tweet_url="https://x.com/example/status/123",
        text="Reviewed reply",
    ))

    assert xuse_is_installed()
    assert result.status == "failed"
    assert result.error_code == "account_not_configured"


def test_invalid_action_fails_before_browser_start(tmp_path):
    result = asyncio.run(send_approved_action(
        x_use_home=tmp_path,
        account="any-account",
        action_type="repost",
        tweet_url=None,
        text="Reviewed text",
    ))

    assert result.status == "failed"
    assert result.error_code == "invalid_action_type"


def test_reply_requires_target_before_browser_start(tmp_path):
    result = asyncio.run(send_approved_action(
        x_use_home=tmp_path,
        account="any-account",
        action_type="reply",
        tweet_url=None,
        text="Reviewed reply",
    ))

    assert result.status == "failed"
    assert result.error_code == "missing_target_url"
