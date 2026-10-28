from __future__ import annotations

import json
import asyncio

from lead_studio.xuse_client import configured_account_keys, configured_account_proxy, send_approved_action, send_approved_reply, xuse_is_installed


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


def test_reads_only_the_requested_accounts_proxy(tmp_path):
    config = tmp_path / "config"
    config.mkdir()
    (config / "accounts.json").write_text(json.dumps([
        {"account_id": "first", "proxy": "http://first.example:9000"},
        {"account_id": "second", "proxy": "socks5://second.example:1080"},
    ]), encoding="utf-8")

    assert configured_account_proxy(tmp_path, "first") == "http://first.example:9000"
    assert configured_account_proxy(tmp_path, "missing") is None


def test_configured_account_without_assigned_route_cannot_fall_back_to_direct(tmp_path):
    config = tmp_path / "config"
    config.mkdir()
    (config / "accounts.json").write_text(json.dumps([
        {"account_id": "first", "is_active": True, "cookies": [{"name": "auth_token"}]},
    ]), encoding="utf-8")

    result = asyncio.run(send_approved_action(
        x_use_home=tmp_path,
        account="first",
        action_type="post",
        tweet_url=None,
        text="Reviewed post",
    ))

    assert result.status == "failed"
    assert result.error_code == "proxy_required"


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
