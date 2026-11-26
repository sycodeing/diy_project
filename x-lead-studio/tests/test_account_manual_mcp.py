"""Contract tests inject an in-memory x-use server; no browser/runtime is loaded."""
import asyncio
from contextlib import asynccontextmanager
import sys
from types import ModuleType, SimpleNamespace

from lead_studio.account_manual_mcp import ACCOUNT, restricted_server


def fake_runtime(monkeypatch):
    counts = {"contexts": 0, "cookies": 0, "navigations": [], "closed": 0, "url": "https://x.com/home", "identity_pending": False, "waits": 0, "pauses": []}
    class SessionError(Exception):
        def __init__(self, reason): self.reason = reason
    class BrowserBlocked(SessionError): pass
    class PolicyError(SessionError): pass
    counts["SessionError"], counts["BrowserBlocked"] = SessionError, BrowserBlocked
    class Locator:
        @property
        def first(self): return self
        async def wait_for(self, **_): pass
        async def count(self): return 0 if counts['identity_pending'] else 1
        async def is_visible(self): return True
        async def get_attribute(self, _): return counts.get('owner_href', '/' + ACCOUNT)
        async def inner_text(self): return '@' + ACCOUNT
    class Browser:
        page = SimpleNamespace(locator=lambda _: Locator())
        async def check_blocked(self): pass
        async def ensure_ready(self):
            error = counts.pop('ready_error', None)
            if error: raise error
            if counts['identity_pending']:
                counts['waits'] += 1
                counts['identity_pending'] = False
        async def navigate(self, url):
            error = counts.pop('navigation_error', None)
            if error: raise error
            counts['navigations'].append(url)
            counts['url'] = url
            counts['identity_pending'] = True
    browser = Browser()
    class Pool:
        backend = "patchright"
        entry = None
        def entry_for(self, _): return self.entry
        def session_status(self, _):
            return {"warm": self.entry is not None, "browser_connected": True, "tab_closed": counts.get("tab_closed", False)}
        @asynccontextmanager
        async def session(self, _):
            assert self.entry is not None, "post must never cold start"
            yield browser
        async def close(self, _): counts['closed'] += 1
    pool = Pool()
    def pause(account, reason, **_):
        if counts.get('pause_error'): raise RuntimeError('offline simulated ledger outage')
        counts['pauses'].append(reason)
    policy = SimpleNamespace(check_pause=lambda *_: None, reserve=lambda *_, **__: "read",
                             finish=lambda *_, **__: None, pause=pause)
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


def test_manual_post_to_home_to_another_post_uses_original_context_and_waits_for_spa(monkeypatch):
    server, counts = fake_runtime(monkeypatch)
    async def check():
        args = dict(account=ACCOUNT, revision="a" * 64, expected_ip="192.0.2.1", session_id="one")
        call = lambda name, **kw: server.tools[name].fn(**kw)
        assert (await call("manual_open", proxy_url="offline-route", **args))["ok"]
        assert (await call("manual_open_post", target_url="https://x.com/pet/status/123456", **args))["ok"]
        counts['url'], counts['identity_pending'] = 'https://x.com/home', True  # user SPA navigation
        before = counts['waits']
        assert (await call('local_status'))['sessionState'] == 'open'
        assert counts['waits'] == before  # heartbeat/local status does no DOM work
        assert (await call("manual_open_post", target_url="https://x.com/dog/status/654321", **args))["ok"]
        assert counts['contexts'] == counts['cookies'] == 1 and counts['closed'] == 0
        assert counts['waits'] > before
        assert counts['navigations'] == ["https://x.com/pet/status/123456", "https://x.com/dog/status/654321"]
        await call('manual_end', account=ACCOUNT)
    asyncio.run(check())


def test_transient_identity_and_navigation_timeout_fail_only_this_explicit_request(monkeypatch):
    server, counts = fake_runtime(monkeypatch)
    async def check():
        args = dict(account=ACCOUNT, revision='a'*64, expected_ip='192.0.2.1', session_id='one')
        call = lambda name, **kw: server.tools[name].fn(**kw)
        assert (await call('manual_open', proxy_url='offline-route', **args))['ok']
        counts['ready_error'] = counts['SessionError']('identity_not_ready')
        result = await call('manual_open_post', target_url='https://x.com/pet/status/123456', **args)
        assert result['failureCategory'] == 'recoverable' and result['stage'] == 'owner_before'
        assert result['sessionState'] == 'open' and counts['pauses'] == []
        counts['navigation_error'] = TimeoutError('offline simulated timeout')
        result = await call('manual_open_post', target_url='https://x.com/pet/status/123456', **args)
        assert result['failureCategory'] == 'recoverable' and result['stage'] == 'navigate'
        assert result['sessionState'] == 'open' and counts['pauses'] == []
        assert counts['navigations'] == []  # failures never automatically replay navigation
        assert (await call('manual_open_post', target_url='https://x.com/dog/status/654321', **args))['ok']
        assert counts['contexts'] == counts['cookies'] == 1
        await call('manual_end', account=ACCOUNT)
    asyncio.run(check())


def test_real_platform_block_and_account_mismatch_still_block_reuse(monkeypatch):
    for fault in ['challenge', 'challenge_pause_error', 'owner_mismatch', 'closed']:
        server, counts = fake_runtime(monkeypatch)
        async def check():
            args = dict(account=ACCOUNT, revision='a'*64, expected_ip='192.0.2.1', session_id='one')
            call = lambda name, **kw: server.tools[name].fn(**kw)
            assert (await call('manual_open', proxy_url='offline-route', **args))['ok']
            if fault.startswith('challenge'):
                counts['ready_error'] = counts['BrowserBlocked']('challenge')
                counts['pause_error'] = fault == 'challenge_pause_error'
            elif fault == 'owner_mismatch': counts['owner_href'] = '/otherAccount'
            else: counts['tab_closed'] = True
            result = await call('manual_open_post', target_url='https://x.com/pet/status/123456', **args)
            assert result['failureCategory'] == ('closed' if fault == 'closed' else 'blocked')
            assert counts['pauses'] == (['challenge'] if fault == 'challenge' else [])
            if fault == 'challenge_pause_error': assert result['pauseRecorded'] is False
            assert not (await call('manual_open_post', target_url='https://x.com/dog/status/654321', **args))['ok']
            assert counts['navigations'] == [] and counts['contexts'] == counts['cookies'] == 1
            await call('manual_end', account=ACCOUNT)
        asyncio.run(check())
