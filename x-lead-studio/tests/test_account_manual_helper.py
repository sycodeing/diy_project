import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from lead_studio.account_manual_helper import ACCOUNT_ID, ACCOUNT_KEY, IP_CHECK_URL, NativeManualSessions, request_is_current


def request(**changes):
    return {"accountId": ACCOUNT_ID, "accountKey": ACCOUNT_KEY, "routeRevision": "a" * 64,
            "expectedIp": "192.0.2.1", "proxyUrl": "socks5://user:pass@example.test:1080", **changes}


class Process:
    pid = 99999999
    closed = False
    def poll(self):
        return 0 if self.closed else None


def test_startup_is_inert_first_open_is_ip_only_and_same_session_does_not_open_new_tab(tmp_path):
    calls, bridges = [], []
    @asynccontextmanager
    async def bridge(value):
        bridges.append("opened")
        yield "http://127.0.0.1:12345"
        bridges.append("closed")
    def launch(args, **kwargs):
        calls.append(args)
        return Process()
    chrome = tmp_path / "Google Chrome"
    chrome.touch()
    manager = NativeManualSessions(tmp_path, launcher=launch, proxy_factory=bridge, chrome=chrome)
    assert calls == bridges == []
    async def check():
        first = await manager.open_ip_window(request())
        second = await manager.open_ip_window(request())
        assert first["status"] == second["status"] == "opened_manual_check"
        assert first["sessionId"] == second["sessionId"]
        assert len(calls) == 1
        assert calls[0][-1] == IP_CHECK_URL
        assert not any("x.com" in arg or "remote-debugging" in arg or "automation" in arg for arg in calls[0])
        assert bridges == ["opened"]
        # A completed send is only a website record; no helper close operation exists.
        await manager.release_after_user_closed()
        assert bridges == ["opened"]
        assert manager.heartbeat_session()["sessionState"] == "open"
        manager.session.process.closed = True
        assert manager.heartbeat_session()["sessionState"] == "closed"
        await manager.release_after_user_closed()
        assert bridges == ["opened", "closed"]
    asyncio.run(check())


def test_route_change_and_closed_window_fail_closed_without_reopening(tmp_path):
    calls = []
    @asynccontextmanager
    async def bridge(_):
        yield "http://127.0.0.1:12345"
    chrome = tmp_path / "Google Chrome"
    chrome.touch()
    def launch(args, **kwargs):
        calls.append(args)
        return Process()
    async def check():
        manager = NativeManualSessions(tmp_path, launcher=launch, proxy_factory=bridge, chrome=chrome)
        await manager.open_ip_window(request())
        assert (await manager.open_ip_window(request(routeRevision="b" * 64)))["status"] == "blocked"
        assert len(calls) == 1 and manager.has_live_window()
        manager.session.process.closed = True
        assert (await manager.open_ip_window(request()))["status"] == "blocked"
        assert len(calls) == 1
        await manager.release_after_user_closed()
    asyncio.run(check())


def test_boot_and_expiry_prevent_replay():
    now = datetime(2026, 11, 24, 10, 0, tzinfo=timezone.utc).timestamp()
    value = request(bootId="new", createdAt="2026-11-24T10:00:00Z", expiresAt="2026-11-24T10:02:00Z")
    assert request_is_current(value, "new", "2026-11-24T10:00:00Z", now)
    assert not request_is_current(value, "next-boot", "2026-11-24T10:00:00Z", now)
    assert not request_is_current(value, "new", "2026-11-24T10:00:01Z", now)
    assert not request_is_current(value, "new", "2026-11-24T10:00:00Z", now + 121)


def test_module_has_no_auto_worker_cookie_or_x_automation_imports():
    import lead_studio.account_manual_helper as helper
    source = Path(helper.__file__).read_text()
    assert "from .app" not in source
    assert "import xuse" not in source and "import patchright" not in source
    assert "add_cookies" not in source and "context.cookies" not in source
    assert "run_x_reply_worker" not in source


def test_actual_helper_startup_only_calls_manual_backend_and_does_not_open_any_window(tmp_path, monkeypatch):
    import httpx
    import lead_studio.account_manual_helper as helper
    callbacks, operations, urls = [], [], []
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): return None
        async def post(self, url, *, headers, json):
            urls.append(url)
            operations.append(json["operation"])
            if json["operation"] == "register":
                return httpx.Response(200, json={"bootedAt": "2026-11-24T10:00:00Z"}, request=httpx.Request("POST", url))
            if json["operation"] == "claim":
                callbacks[0]()
                return httpx.Response(204, request=httpx.Request("POST", url))
            return httpx.Response(200, json={"ok": True}, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_: Client())
    async def forbidden(*_): raise AssertionError("startup must never open a proxy/browser")
    monkeypatch.setattr(helper.NativeManualSessions, "open_ip_window", forbidden)
    async def check():
        loop = asyncio.get_running_loop()
        monkeypatch.setattr(loop, "add_signal_handler", lambda _sig, callback: callbacks.append(callback))
        await helper.run_helper("https://www.thebestdiyshop.com", "test-only-secret", tmp_path)
    asyncio.run(check())
    assert operations == ["register", "heartbeat", "claim", "stop"]
    assert set(urls) == {"https://www.thebestdiyshop.com/api/x-account-manual/helper"}
