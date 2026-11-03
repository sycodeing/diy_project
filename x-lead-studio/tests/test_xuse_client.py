from __future__ import annotations

import json
import asyncio
import sys
import types
from contextlib import asynccontextmanager

from lead_studio import xuse_client
from lead_studio.xuse_client import NetworkProbeResult, configured_account_keys, configured_account_proxy, probe_network_route, send_approved_action, send_approved_reply, xuse_is_installed


def _install_fake_mcp(monkeypatch, session):
    @asynccontextmanager
    async def fake_stdio_client(_parameters, errlog=None):
        yield object(), object()

    fake_mcp = types.ModuleType("mcp")
    fake_mcp.ClientSession = lambda _read, _write: session
    fake_mcp.StdioServerParameters = lambda **kwargs: kwargs
    fake_stdio = types.ModuleType("mcp.client.stdio")
    fake_stdio.stdio_client = fake_stdio_client
    monkeypatch.setitem(sys.modules, "mcp", fake_mcp)
    monkeypatch.setitem(sys.modules, "mcp.client.stdio", fake_stdio)


def test_direct_browser_probe_uses_fallback_after_primary_failure(monkeypatch):
    visited = []

    class FakePage:
        def __init__(self):
            self.url = ""

        async def goto(self, url, **_kwargs):
            self.url = url
            visited.append(url)
            if url == "https://primary.example.test/ip":
                raise RuntimeError("primary unavailable")

        async def text_content(self, _selector):
            return '{"ip":"203.0.113.10"}'

        async def close(self):
            return None

    class FakeContext:
        async def new_page(self):
            return FakePage()

    class FakeBrowser:
        async def new_context(self):
            return FakeContext()

        async def close(self):
            return None

    class FakeChromium:
        async def launch(self, **_kwargs):
            return FakeBrowser()

    class FakePlaywright:
        chromium = FakeChromium()

    class FakeManager:
        async def __aenter__(self):
            return FakePlaywright()

        async def __aexit__(self, *_args):
            return None

    import patchright.async_api

    monkeypatch.setattr(patchright.async_api, "async_playwright", lambda: FakeManager())
    result = asyncio.run(xuse_client.probe_direct_egress("https://primary.example.test/ip"))

    assert result == NetworkProbeResult(True, egress_ip="203.0.113.10")
    assert visited == ["https://primary.example.test/ip", "https://api64.ipify.org?format=json"]


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
        network_mode="fixed_proxy",
        ip_check_url="https://ip.example.test",
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
        network_mode="vpn_direct",
        ip_check_url="https://ip.example.test",
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
        network_mode="vpn_direct",
        ip_check_url="https://ip.example.test",
    ))

    assert result.status == "failed"
    assert result.error_code == "missing_target_url"


def test_vpn_direct_probe_never_starts_xuse_proxy_tools(monkeypatch, tmp_path):
    async def direct_probe(_url):
        return NetworkProbeResult(True, egress_ip="203.0.113.10")

    monkeypatch.setattr(xuse_client, "probe_direct_egress", direct_probe)
    monkeypatch.setattr(xuse_client, "xuse_is_installed", lambda: False)
    result = asyncio.run(probe_network_route(
        x_use_home=tmp_path,
        account="first",
        network_mode="vpn_direct",
        proxy_url=None,
        ip_check_url="https://ip.example.test",
    ))

    assert result.ok is True
    assert result.egress_ip == "203.0.113.10"


def test_fixed_proxy_calls_update_and_test_proxy_without_direct_fallback(monkeypatch, tmp_path):
    config = tmp_path / "config"
    config.mkdir()
    (config / "accounts.json").write_text(json.dumps([
        {"account_id": "first", "proxy": "http://old.example:9000"},
    ]), encoding="utf-8")

    class FakeSession:
        def __init__(self):
            self.calls = []

        async def call_tool(self, name, arguments):
            self.calls.append((name, arguments))
            if name == "test_proxy":
                return types.SimpleNamespace(structuredContent={"result": {"ok": True, "egress_ip": "198.51.100.7"}}, content=[])
            return types.SimpleNamespace(structuredContent={"result": {"ok": True}}, content=[])

    session = FakeSession()
    result = asyncio.run(xuse_client._probe_fixed_proxy(
        session,
        x_use_home=tmp_path,
        account="first",
        proxy_url="http://user:password@fixed.example:9000",
    ))

    assert result.ok is True
    assert [name for name, _ in session.calls] == ["update_account", "test_proxy"]
    assert result.egress_ip == "198.51.100.7"


def test_fixed_proxy_failure_never_falls_back_to_direct(monkeypatch, tmp_path):
    config = tmp_path / "config"
    config.mkdir()
    proxy = "http://user:password@fixed.example:9000"
    (config / "accounts.json").write_text(json.dumps([
        {"account_id": "first", "proxy": proxy},
    ]), encoding="utf-8")

    class FakeSession:
        def __init__(self):
            self.calls = []

        async def call_tool(self, name, arguments):
            self.calls.append((name, arguments))
            return types.SimpleNamespace(structuredContent={"result": {"ok": False, "error": {"type": "proxy_failed", "message": "route unavailable"}}}, content=[])

    async def forbidden_direct_probe(_url):
        raise AssertionError("fixed_proxy must not fall back to direct")

    session = FakeSession()
    monkeypatch.setattr(xuse_client, "probe_direct_egress", forbidden_direct_probe)
    result = asyncio.run(xuse_client._probe_fixed_proxy(
        session,
        x_use_home=tmp_path,
        account="first",
        proxy_url=proxy,
    ))

    assert result.ok is False
    assert result.error_code == "proxy_failed"
    assert [name for name, _ in session.calls] == ["test_proxy"]


def test_failed_browser_egress_blocks_draft_creation(monkeypatch, tmp_path):
    config = tmp_path / "config"
    config.mkdir()
    (config / "accounts.json").write_text(json.dumps([
        {"account_id": "first", "is_active": True, "cookies": [{"name": "auth_token"}]},
    ]), encoding="utf-8")

    async def failed_probe(_url):
        return NetworkProbeResult(False, error_code="browser_probe_failed", error_message="VPN route unavailable")

    monkeypatch.setattr(xuse_client, "xuse_is_installed", lambda: True)
    monkeypatch.setattr(xuse_client, "probe_direct_egress", failed_probe)
    result = asyncio.run(send_approved_action(
        x_use_home=tmp_path,
        account="first",
        action_type="post",
        tweet_url=None,
        text="Reviewed post",
        network_mode="vpn_direct",
        ip_check_url="https://ip.example.test",
    ))

    assert result.status == "failed"
    assert result.error_code == "browser_probe_failed"


def test_approved_text_is_passed_unchanged_and_only_pending_draft_is_approved(monkeypatch, tmp_path):
    config = tmp_path / "config"
    config.mkdir()
    (config / "accounts.json").write_text(json.dumps([
        {"account_id": "first", "is_active": True, "cookies": [{"name": "auth_token"}]},
    ]), encoding="utf-8")
    calls = []

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def initialize(self):
            return None

        async def call_tool(self, name, arguments):
            calls.append((name, arguments))
            if name == "post_tweet":
                return types.SimpleNamespace(structuredContent={"result": {"ok": True, "status": "pending", "draft_id": "draft-1"}}, content=[])
            if name == "approve_draft":
                return types.SimpleNamespace(structuredContent={"result": {"ok": True, "action_id": "action-1", "url": "https://x.com/example/status/1"}}, content=[])
            raise AssertionError(name)

    _install_fake_mcp(monkeypatch, FakeSession())
    monkeypatch.setattr(xuse_client, "xuse_is_installed", lambda: True)

    async def direct_probe(_url):
        return NetworkProbeResult(True, egress_ip="203.0.113.10")

    monkeypatch.setattr(xuse_client, "probe_direct_egress", direct_probe)
    approved_text = "Exactly reviewed text — keep unchanged."
    preview_path = tmp_path / "approved-preview.webp"
    preview_path.write_bytes(b"preview")
    result = asyncio.run(send_approved_action(
        x_use_home=tmp_path,
        account="first",
        action_type="post",
        tweet_url=None,
        text=approved_text,
        media=[str(preview_path)],
        network_mode="vpn_direct",
        ip_check_url="https://ip.example.test",
        verify_route=lambda _ip: asyncio.sleep(0, result=(True, None)),
    ))

    assert result.status == "sent"
    assert calls[0] == ("post_tweet", {"account": "first", "text": approved_text, "media": [str(preview_path)]})
    assert calls[1] == ("approve_draft", {"draft_id": "draft-1"})


def test_non_pending_draft_is_never_approved(monkeypatch, tmp_path):
    config = tmp_path / "config"
    config.mkdir()
    (config / "accounts.json").write_text(json.dumps([
        {"account_id": "first", "is_active": True, "cookies": [{"name": "auth_token"}]},
    ]), encoding="utf-8")
    calls = []

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def initialize(self):
            return None

        async def call_tool(self, name, arguments):
            calls.append((name, arguments))
            return types.SimpleNamespace(structuredContent={"result": {"ok": True, "status": "sent", "draft_id": "bad-draft"}}, content=[])

    _install_fake_mcp(monkeypatch, FakeSession())
    monkeypatch.setattr(xuse_client, "xuse_is_installed", lambda: True)

    async def direct_probe(_url):
        return NetworkProbeResult(True, egress_ip="203.0.113.10")

    monkeypatch.setattr(xuse_client, "probe_direct_egress", direct_probe)
    result = asyncio.run(send_approved_action(
        x_use_home=tmp_path,
        account="first",
        action_type="post",
        tweet_url=None,
        text="Reviewed post",
        network_mode="vpn_direct",
        ip_check_url="https://ip.example.test",
    ))

    assert result.status == "failed"
    assert result.error_code == "draft_gate_missing"
    assert [name for name, _ in calls] == ["post_tweet"]


def test_server_rejected_vpn_egress_blocks_draft_creation(monkeypatch, tmp_path):
    config = tmp_path / "config"
    config.mkdir()
    (config / "accounts.json").write_text(json.dumps([
        {"account_id": "first", "is_active": True, "cookies": [{"name": "auth_token"}]},
    ]), encoding="utf-8")

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def initialize(self):
            return None

        async def call_tool(self, _name, _arguments):
            raise AssertionError("a rejected egress must block draft creation")

    _install_fake_mcp(monkeypatch, FakeSession())
    monkeypatch.setattr(xuse_client, "xuse_is_installed", lambda: True)

    async def direct_probe(_url):
        return NetworkProbeResult(True, egress_ip="203.0.113.11")

    monkeypatch.setattr(xuse_client, "probe_direct_egress", direct_probe)
    result = asyncio.run(send_approved_action(
        x_use_home=tmp_path,
        account="first",
        action_type="post",
        tweet_url=None,
        text="Reviewed post",
        network_mode="vpn_direct",
        ip_check_url="https://ip.example.test",
        verify_route=lambda _ip: asyncio.sleep(0, result=(False, "locked IP mismatch")),
    ))

    assert result.status == "failed"
    assert result.error_code == "network_route_rejected"


def test_approval_failures_are_classified_fail_closed():
    assert xuse_client._approval_failure_status("validation_error", None) == "failed"
    assert xuse_client._approval_failure_status("send_unconfirmed", None) == "uncertain"
    assert xuse_client._approval_failure_status("validation_error", "action-1") == "uncertain"


def test_sensitive_proxy_credentials_are_redacted_from_errors():
    value = xuse_client._redact_sensitive("failed http://alice:secret@proxy.example:9000 Authorization: Bearer worker-secret Cookie: auth_token=cookie-secret; ct0=csrf-secret")
    assert "alice" not in value
    assert "secret" not in value
    assert "worker-secret" not in value
    assert "cookie-secret" not in value
    assert "csrf-secret" not in value
