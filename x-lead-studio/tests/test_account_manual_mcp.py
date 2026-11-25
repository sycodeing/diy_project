"""Contract tests inject an in-memory x-use server; no browser/runtime is loaded."""
import asyncio
from contextlib import asynccontextmanager
import sys
from types import ModuleType, SimpleNamespace

from lead_studio.account_manual_mcp import ACCOUNT, restricted_server


def fake_runtime(monkeypatch):
    counts = {"contexts": 0, "cookies": 0, "navigations": [], "closed": 0}
    class SessionError(Exception):
        def __init__(self, reason): self.reason = reason
    class BrowserBlocked(SessionError): pass
    class PolicyError(SessionError): pass
    class Locator:
        async def count(self): return 1
        async def is_visible(self): return True
        async def get_attribute(self, _): return '/' + ACCOUNT
        async def inner_text(self): return '@' + ACCOUNT
    class Browser:
        page = SimpleNamespace(locator=lambda _: Locator())
        async def check_blocked(self): pass
        async def navigate(self, url): counts['navigations'].append(url)
    browser = Browser()
    class Pool:
        backend = "patchright"
        entry = None
        def entry_for(self, _): return self.entry
        def session_status(self, _):
            return {"warm": self.entry is not None, "browser_connected": True, "tab_closed": False}
        @asynccontextmanager
        async def session(self, _):
            assert self.entry is not None, "post must never cold start"
            yield browser
        async def close(self, _): counts['closed'] += 1
    pool = Pool()
    policy = SimpleNamespace(check_pause=lambda *_: None, reserve=lambda *_, **__: "read",
                             finish=lambda *_, **__: None, pause=lambda *_, **__: None)
    ctx = SimpleNamespace(session_pool=pool, safety_store=policy,
                          config_loader=SimpleNamespace(accounts=[{"account_id": ACCOUNT}]))
    class Server:
        xuse_ctx = ctx
        def __init__(self):
            self.xuse_auto_drain = object()
            async def probe(**_): return {"ok": True, "egress_ip": "192.0.2.1"}
            self.tools = {"test_proxy": SimpleNamespace(fn=probe, name="test_proxy")}
            self._tool_manager = self
        def get_tool(self, name): return self.tools[name]
        def list_tools(self): return list(self.tools.values())
        def remove_tool(self, name): self.tools.pop(name)
        def tool(self):
            def decorate(fn):
                self.tools[fn.__name__] = SimpleNamespace(fn=fn, name=fn.__name__)
                return fn
            return decorate
    server = Server()
    async def browser_call(ctx, account, operation, **_):
        assert operation == "ensure_ready"
        if pool.entry is None:
            counts['contexts'] += 1
            counts['cookies'] += 1
            pool.entry = SimpleNamespace(closing=False, browser_manager=browser)
    modules = {
        "lead_studio.xuse_compat": dict(install_xuse_reply_preview_compatibility=lambda: None),
        "xuse.mcp.server": dict(create_server=lambda: server),
        "xuse.mcp.browser_bridge": dict(browser_call=browser_call),
        "xuse.mcp.executor": dict(resolve_account=lambda *_: (ACCOUNT, {}, None), require_active=lambda *_: None),
        "xuse.browser.errors": dict(BrowserBlocked=BrowserBlocked, SessionError=SessionError),
        "xuse.mcp.safety": dict(PolicyError=PolicyError),
    }
    for name, attrs in modules.items():
        module = ModuleType(name)
        module.__dict__.update(attrs)
        monkeypatch.setitem(sys.modules, name, module)
    return restricted_server(), counts


def test_original_pool_context_and_cookie_import_are_created_once_for_multiple_posts(monkeypatch):
    server, counts = fake_runtime(monkeypatch)
    call = lambda name, **args: server.tools[name].fn(**args)
    async def check():
        args = dict(account=ACCOUNT, revision="a" * 64, expected_ip="192.0.2.1", session_id="one")
        assert (await call("manual_open", proxy_url="offline-route", **args))["ok"]
        assert (await call("manual_open", proxy_url="offline-route", **args))["reused"]
        for url in ["https://x.com/pet/status/123456", "https://x.com/dog/status/654321"]:
            assert (await call("manual_open_post", target_url=url, **args))["ok"]
        assert counts['contexts'] == counts['cookies'] == 1
        assert counts['navigations'] == ["https://x.com/pet/status/123456", "https://x.com/dog/status/654321"]
        for change in [dict(account="other"), dict(expected_ip="192.0.2.2"), dict(session_id="lost")]:
            assert not (await call("manual_open_post", target_url="https://x.com/pet/status/123456", **dict(args, **change)))["ok"]
        assert len(counts['navigations']) == 2 and counts['closed'] == 0
        await call("manual_end", account=ACCOUNT)
    asyncio.run(check())
    assert set(server.tools) == {"manual_open", "manual_open_post", "local_status", "manual_end"}
