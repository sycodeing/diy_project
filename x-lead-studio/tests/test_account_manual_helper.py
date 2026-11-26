import asyncio
from datetime import datetime, timezone
from pathlib import Path

from lead_studio.account_manual_helper import ACCOUNT_ID, ACCOUNT_KEY, CAPABILITY, request_is_current
from lead_studio.account_manual_xuse import XUseManualSessions


def request(**changes):
    return {"accountId": ACCOUNT_ID, "accountKey": ACCOUNT_KEY, "routeRevision": "a" * 64,
            "purpose": "account_x_home", "taskId": None, "expectedIp": "192.0.2.1", **changes}


def test_new_purpose_boot_and_expiry_prevent_native_or_previous_authorization_replay():
    now = datetime(2026, 11, 24, 10, 0, tzinfo=timezone.utc).timestamp()
    value = request(bootId="new", createdAt="2026-11-24T10:00:00Z", expiresAt="2026-11-24T10:02:00Z")
    assert request_is_current(value, "new", "2026-11-24T10:00:00Z", now)
    for changes in ({"purpose": "legacy_ip"}, {"purpose": "manual_task"}, {"purpose": "manual_task_x_home"},
                    {"accountKey": "Latte192837465"}, {"bootId": "old"}, {"taskId": "dummy-task"}):
        assert not request_is_current(dict(value, **changes), "new", "2026-11-24T10:00:00Z", now)
    assert not request_is_current(value, "new", "2026-11-24T10:00:01Z", now)
    assert not request_is_current(value, "new", "2026-11-24T10:00:00Z", now + 121)


def test_existing_xuse_session_is_reused_without_navigation_and_route_change_is_terminal(tmp_path):
    manager = XUseManualSessions(tmp_path)
    assert manager.client is None and manager.resources is None
    assert manager.heartbeat_session() == {"sessionState": "idle", "idleNeverStarted": True}
    manager.client = object()
    state = {"ok": True, "sessionState": "open", "live": True, "sessionId": "one",
             "routeRevision": "a" * 64, "expectedIp": "192.0.2.1", "ownerHandle": ACCOUNT_KEY}
    calls = []
    async def fake_call(name, args):
        calls.append(name)
        assert name == "local_status"  # never reopens, navigates or approves
        return dict(state)
    manager._call = fake_call
    async def check():
        manager.state = dict(state)
        first, second = await manager.open_home(request()), await manager.open_home(request())
        assert first["status"] == second["status"] == "opened_x_home"
        assert first["sessionId"] == second["sessionId"] == "one"
        assert calls == ["local_status", "local_status"]
        assert (await manager.open_home(request(routeRevision="b" * 64)))["status"] == "blocked"
        assert manager.has_live_window()  # route preserved, not silently closed
        assert (await manager.open_home(request()))["status"] == "blocked"
    asyncio.run(check())


def test_local_transport_error_preserves_window_without_claiming_a_permanent_platform_block(tmp_path):
    manager = XUseManualSessions(tmp_path)
    manager.client = object()
    manager.state = {"sessionState": "open", "live": True}
    async def fail(*_): raise TimeoutError()
    manager._call = fail
    asyncio.run(manager.poll_local_status())
    assert not manager.blocked and manager.transport_unavailable and manager.has_live_window()
    assert manager.heartbeat_session()["sessionState"] == "open"


def test_only_after_user_page_closed_release_calls_end_then_closes_mcp_relay(tmp_path):
    manager = XUseManualSessions(tmp_path)
    manager.client = object()
    events = []
    class Resources:
        async def aclose(self): events.append("close_resources")
    manager.resources = Resources()
    async def fake_call(name, args):
        events.append(name)
        assert name == "manual_end" and args == {"account": ACCOUNT_KEY}
        return {"ok": True}
    manager._call = fake_call
    async def check():
        manager.state = {"live": True}
        await manager.release_after_user_closed()
        assert events == []
        manager.state["live"] = False
        await manager.release_after_user_closed()
        assert events == ["manual_end", "close_resources"]
    asyncio.run(check())


def test_actual_idle_helper_never_imports_xuse_or_starts_mcp(tmp_path, monkeypatch):
    import builtins
    import httpx
    import lead_studio.account_manual_helper as helper
    callbacks, operations = [], []
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): return None
        async def post(self, url, *, headers, json):
            assert url == "https://www.thebestdiyshop.com/api/x-account-manual/helper"
            assert json["capability"] == CAPABILITY
            operations.append(json["operation"])
            response = {"bootedAt": "2026-11-24T10:00:00Z"} if json["operation"] == "register" else {"ok": True}
            if json["operation"] == "claim": callbacks[0]()
            return httpx.Response(204 if json["operation"] == "claim" else 200, json=response,
                                  request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_: Client())
    original_import = builtins.__import__
    def guarded_import(name, *args, **kwargs):
        assert name.split('.')[0] not in {"xuse", "mcp", "patchright"}, "idle helper imported browser runtime"
        return original_import(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", guarded_import)
    async def check():
        loop = asyncio.get_running_loop()
        monkeypatch.setattr(loop, "add_signal_handler", lambda _sig, callback, *args: callbacks.append(lambda: callback(*args)))
        await helper.run_helper("https://www.thebestdiyshop.com", "fake-secret", tmp_path, tmp_path / "fake-xuse-home")
    asyncio.run(check())
    assert operations == ["register", "heartbeat", "claim", "stop", "stop"]
    assert not (tmp_path / "fake-xuse-home").exists()


def test_post_requests_only_reuse_owned_client_and_never_start_a_context(tmp_path):
    manager = XUseManualSessions(tmp_path)
    post = request(purpose="manual_task_x_post", taskId="one", targetPostUrl="https://x.com/pet/status/123456")
    assert asyncio.run(manager.open_post(post))["status"] == "blocked"
    assert manager.client is None and not tmp_path.joinpath("logs").exists()
    manager.client = object()
    state = {"ok": True, "sessionState": "open", "live": True, "sessionId": "one",
             "routeRevision": "a" * 64, "expectedIp": "192.0.2.1", "ownerHandle": ACCOUNT_KEY}
    calls = []
    async def fake_call(name, args):
        calls.append((name, args))
        assert name in {"local_status", "manual_open_post"}
        return dict(state)
    manager._call = fake_call
    async def check():
        for target in ["https://x.com/pet/status/123456", "https://x.com/dog/status/654321"]:
            assert (await manager.open_post(dict(post, targetPostUrl=target)))["status"] == "opened_x_post"
        assert [args["target_url"] for name, args in calls if name == "manual_open_post"] == ["https://x.com/pet/status/123456", "https://x.com/dog/status/654321"]
        assert (await manager.open_post(dict(post, accountKey="other")))["status"] == "blocked"
        assert (await manager.open_post(dict(post, expectedIp="192.0.2.2")))["status"] == "blocked"
        assert manager.has_live_window()
    asyncio.run(check())


def test_long_open_keeps_independent_heartbeat_and_stop_preserves_window(tmp_path, monkeypatch):
    import httpx
    import lead_studio.account_manual_helper as helper
    import lead_studio.account_manual_xuse as xuse
    callbacks, operations, beats_during_open = [], [], []
    clock = {"opening": False, "claimed": False, "closed": False}
    class Sessions:
        def __init__(self, _): self.blocked = False
        async def poll_local_status(self): pass
        def heartbeat_session(self): return {"sessionState": "open" if clock["opening"] else "idle"}
        def has_live_window(self): return clock["opening"] and not clock["closed"]
        async def open_home(self, _):
            clock["opening"] = True
            # Simulated long browser operation spans several heartbeat periods.
            await asyncio.sleep(.04)
            assert len(beats_during_open) >= 2
            return {"status": "blocked", "message": "offline simulated result"}
        async def release_after_user_closed(self):
            assert not self.has_live_window()
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): return None
        async def post(self, url, *, headers, json):
            operation = json["operation"]
            operations.append(operation)
            if operation == "register": payload = {"bootedAt": "2026-11-24T10:00:00Z"}
            elif operation == "claim" and not clock["claimed"]:
                clock["claimed"] = True
                payload = {"request": request(bootId=json["bootId"], id="request", createdAt="2026-11-24T10:00:00Z", expiresAt="2099-11-24T10:02:00Z")}
            else: payload = {"ok": True}
            if operation == "heartbeat" and clock["opening"]: beats_during_open.append(operation)
            if operation == "complete": callbacks[0]()
            if operation == "stop":
                assert clock["opening"]  # retained until explicit simulated user close
                clock["closed"] = True
            return httpx.Response(200, json=payload, request=httpx.Request("POST", url))
    monkeypatch.setattr(xuse, "XUseManualSessions", Sessions)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_: Client())
    monkeypatch.setattr(helper, "HEARTBEAT_SECONDS", .005)
    async def check():
        loop = asyncio.get_running_loop()
        monkeypatch.setattr(loop, "add_signal_handler", lambda _sig, callback, *args: callbacks.append(lambda: callback(*args)))
        await helper.run_helper("https://www.thebestdiyshop.com", "fake-secret", tmp_path, tmp_path)
    asyncio.run(check())
    assert operations.count("register") == 1
    assert operations.count("complete") == 1 and operations[-1] == "stop"


def test_stop_during_claim_does_not_start_the_returned_navigation(tmp_path, monkeypatch):
    import httpx
    import lead_studio.account_manual_helper as helper
    import lead_studio.account_manual_xuse as xuse
    callbacks, operations = [], []
    class Sessions:
        def __init__(self, _): pass
        def heartbeat_session(self): return {"sessionState": "idle"}
        def has_live_window(self): return False
        async def poll_local_status(self): pass
        async def open_home(self, _): raise AssertionError("must not start after stop")
        async def open_post(self, _): raise AssertionError("must not navigate after stop")
        async def release_after_user_closed(self): pass
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        async def post(self, url, *, headers, json):
            op = json['operation']
            operations.append(op)
            payload = {"bootedAt": "2026-11-24T10:00:00Z"} if op == "register" else {"ok": True}
            if op == "claim":
                callbacks[0]()
                payload = {"request": request(id="request", bootId=json['bootId'], purpose="manual_task_x_post", taskId="one", createdAt="2026-11-24T10:00:00Z", expiresAt="2099-11-24T10:02:00Z")}
            if op == "complete": assert json['status'] == 'blocked'
            return httpx.Response(200, json=payload, request=httpx.Request("POST", url))
    monkeypatch.setattr(xuse, "XUseManualSessions", Sessions)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_: Client())
    async def check():
        monkeypatch.setattr(asyncio.get_running_loop(), "add_signal_handler", lambda _sig, callback, *args: callbacks.append(lambda: callback(*args)))
        await helper.run_helper("https://www.thebestdiyshop.com", "fake-secret", tmp_path, tmp_path)
    asyncio.run(check())
    assert operations == ['register', 'heartbeat', 'claim', 'complete', 'stop', 'stop']


def test_idle_network_recovery_after_sleep_retries_only_backend_without_register_or_x(tmp_path, monkeypatch):
    import builtins
    import httpx
    import lead_studio.account_manual_helper as helper
    callbacks, operations = [], []
    clock = {"now": 1000., "claims": 0, "beats": 0}
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        async def post(self, url, *, headers, json):
            assert url == "https://www.thebestdiyshop.com/api/x-account-manual/helper"
            op = json['operation']
            operations.append(op)
            if op == "heartbeat":
                clock['beats'] += 1
                assert json['idleNeverStarted'] is True
                if clock['beats'] == 2: raise httpx.ConnectError("offline simulated wake")
            if op == "claim":
                clock['claims'] += 1
                if clock['claims'] == 1: clock['now'] += 70  # >45s sleep/network gap
                else: callbacks[0]()
            payload = {"bootedAt": "2026-11-24T10:00:00Z"} if op == "register" else {"ok": True}
            return httpx.Response(204 if op == "claim" else 200, json=payload, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_: Client())
    monkeypatch.setattr(helper, "HEARTBEAT_SECONDS", .001)
    monkeypatch.setattr(helper.time, "time", lambda: clock['now'])
    original = builtins.__import__
    def guarded(name, *args, **kwargs):
        assert name.split('.')[0] not in {"xuse", "mcp", "patchright"}
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", guarded)
    async def check():
        monkeypatch.setattr(asyncio.get_running_loop(), "add_signal_handler", lambda _sig, callback, *args: callbacks.append(lambda: callback(*args)))
        await helper.run_helper("https://www.thebestdiyshop.com", "fake-secret", tmp_path, tmp_path / 'unused-xuse')
    asyncio.run(check())
    assert operations.count('register') == 1 and clock['beats'] >= 3
    assert operations.count('claim') == 2 and operations[-2:] == ['stop', 'stop']
    assert not (tmp_path / 'unused-xuse').exists()


def test_never_started_proof_is_latched_off_after_any_attempt_even_if_client_is_gone(tmp_path):
    manager = XUseManualSessions(tmp_path)
    assert manager.can_renew_idle_heartbeat()
    manager.ever_attempted = True
    manager.client = manager.resources = None
    assert not manager.can_renew_idle_heartbeat()
    assert 'idleNeverStarted' not in manager.heartbeat_session()


def test_backend_explicit_rejection_stops_idle_helper_without_reregister(tmp_path, monkeypatch):
    import httpx
    import lead_studio.account_manual_helper as helper
    operations = []
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        async def post(self, url, *, headers, json):
            operations.append(json['operation'])
            payload = {"bootedAt": "2026-11-24T10:00:00Z"} if json['operation'] == 'register' else {"ok": True}
            return httpx.Response(409 if json['operation'] == 'heartbeat' else 200, json=payload, request=httpx.Request('POST',url))
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **_: Client())
    async def check():
        monkeypatch.setattr(asyncio.get_running_loop(), 'add_signal_handler', lambda *_: None)
        await helper.run_helper('https://www.thebestdiyshop.com','fake-secret',tmp_path,tmp_path)
    asyncio.run(check())
    assert operations == ['register','heartbeat','stop','stop']


def test_recoverable_post_failure_preserves_context_and_next_explicit_request_revalidates(tmp_path):
    manager = XUseManualSessions(tmp_path)
    manager.client = object()
    state = {"ok": True, "sessionState": "open", "live": True, "sessionId": "one",
             "routeRevision": "a"*64, "expectedIp": "192.0.2.1", "ownerHandle": ACCOUNT_KEY}
    calls = []
    async def fake(name, args):
        calls.append(name)
        if name == 'manual_open_post' and calls.count(name) == 1:
            return {**state, "ok": False, "failureCategory": "recoverable", "stage": "owner_after", "reason": "identity_not_ready"}
        return dict(state)
    manager._call = fake
    async def check():
        value = request(purpose='manual_task_x_post', taskId='one', targetPostUrl='https://x.com/pet/status/123456')
        result = await manager.open_post(value)
        assert result['status'] == 'failed' and result['failureCategory'] == 'recoverable'
        assert 'owner_after/identity_not_ready' in result['message']
        assert not manager.blocked and manager.has_live_window()
        assert calls == ['local_status', 'manual_open_post']
        assert (await manager.open_post(dict(value, targetPostUrl='https://x.com/dog/status/654321')))['status'] == 'opened_x_post'
        assert calls == ['local_status', 'manual_open_post', 'local_status', 'manual_open_post']
    asyncio.run(check())


def test_one_local_status_rpc_failure_allows_only_next_explicit_request_to_revalidate(tmp_path):
    manager = XUseManualSessions(tmp_path)
    original = manager.client = object()
    state = {"ok": True, "sessionState": "open", "live": True, "sessionId": "one",
             "routeRevision": "a"*64, "expectedIp": "192.0.2.1", "ownerHandle": ACCOUNT_KEY}
    manager.state = dict(state)
    calls = []
    async def fake(name, args):
        calls.append(name)
        if len(calls) == 1: raise TimeoutError('offline local RPC failure')
        return dict(state)
    manager._call = fake
    async def check():
        value = request(purpose='manual_task_x_post', taskId='one', targetPostUrl='https://x.com/pet/status/123456')
        assert (await manager.open_post(value))['status'] == 'failed'
        assert calls == ['local_status'] and not manager.blocked and manager.has_live_window()
        assert (await manager.open_post(value))['status'] == 'opened_x_post'
        assert calls == ['local_status', 'local_status', 'manual_open_post']
        assert manager.client is original
    asyncio.run(check())
