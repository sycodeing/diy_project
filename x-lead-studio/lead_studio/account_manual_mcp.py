"""Restricted stdio adapter around the installed x-use runtime.

Only a fresh explicit web request starts this process. Browser construction,
Cookie loading, readiness, policy and transport remain owned by x-use.
"""
from __future__ import annotations

import asyncio
import re
import json
import sys
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin, urlsplit

ACCOUNT = "Le6wCummeratawi"
CAPABILITY = "xuse-manual-read-v3"


def restricted_server():
    # Kept inside this explicit-process factory, never imported by idle helper.
    from .xuse_compat import install_xuse_reply_preview_compatibility
    install_xuse_reply_preview_compatibility()
    from xuse.mcp.server import create_server
    from xuse.mcp.browser_bridge import browser_call
    from xuse.mcp.executor import resolve_account, require_active
    from xuse.browser.errors import BrowserBlocked, SessionError
    from xuse.mcp.safety import PolicyError

    server = create_server()
    ctx = server.xuse_ctx
    if getattr(ctx.session_pool, "backend", None) != "patchright":
        raise RuntimeError("Manual adapter requires the existing patchright backend.")
    # Capture the original guarded anonymous proxy probe before removing every
    # original transport tool. No update/send/approve/queue/recovery capability.
    probe = server._tool_manager.get_tool("test_proxy").fn
    for tool in tuple(server._tool_manager.list_tools()):
        server.remove_tool(tool.name)
    if hasattr(server, "xuse_auto_drain"):
        delattr(server, "xuse_auto_drain")
    assert not hasattr(server, "xuse_auto_drain")
    held: dict[str, Any] = {"task": None, "release": None, "ready": None, "entry": None,
                            "blocked": False, "closed": False, "session_id": None, "revision": None,
                            "expected_ip": None, "owner": None}
    opening = asyncio.Lock()

    def local_state():
        metadata = ctx.session_pool.session_status(ACCOUNT)
        # A disconnected driver is not proof the operator's window vanished.
        live = bool(metadata.get("warm") and metadata.get("tab_closed") is not True)
        closed = held["closed"] or held["session_id"] and (metadata.get("tab_closed") is True or not metadata.get("warm") or metadata.get("browser_connected") is False)
        state = "closed" if closed else "blocked" if held["blocked"] else "open" if live and held["entry"] and held["owner"] else "idle"
        return {"sessionState": state, "live": live, "sessionId": held["session_id"],
                "routeRevision": held["revision"], "expectedIp": held["expected_ip"],
                "ownerHandle": held["owner"], "transport": metadata}

    def failure(error, stage, initial=False):
        raw_reason = getattr(error, "reason", None)
        reason = raw_reason if isinstance(raw_reason, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,63}", raw_reason) else "technical_error"
        category, pause_recorded = "recoverable", None
        if isinstance(error, BrowserBlocked):
            category = "blocked"
            held["blocked"] = True  # Remains blocked even if pause persistence fails.
            try:
                ctx.safety_store.pause(ACCOUNT, reason, preserve_manual=True)
                pause_recorded = True
            except Exception:
                pause_recorded = False
        elif reason in {"ownership_mismatch", "invalid_proxy", "fixed_account_required", "binding_mismatch"}:
            category = "blocked"
        elif isinstance(error, PolicyError) and reason not in {"cooldown", "minute_budget", "daily_budget"}:
            category = "blocked"  # Existing pauses are never cleared.
        elif reason == "session_expired" or local_state()["sessionState"] == "closed":
            category = "closed"
        if initial and category == "recoverable":
            category = "blocked"
        if category == "blocked":
            held["blocked"] = True
        elif category == "closed":
            held["closed"] = True
        diagnostic = {"reason": reason, "stage": stage, "failureCategory": category}
        if pause_recorded is not None:
            diagnostic["pauseRecorded"] = pause_recorded
        print(json.dumps({"event": "manual_request_failed", "at": datetime.now(timezone.utc).isoformat(), **diagnostic}), file=sys.stderr, flush=True)
        return {"ok": False, **diagnostic, **local_state()}

    async def lease():
        try:
            async with ctx.session_pool.session(ACCOUNT) as browser:
                held["entry"] = browser
                held["ready"].set()
                await held["release"].wait()
        finally:
            held["entry"] = None
            held["ready"].set()

    async def owner_from_current_page(browser):
        # Same visible controls used by the existing local identity check.
        # A public profile or the Cookie owner lock is not login identity proof.
        # Official readiness only waits/reads this page; verify_session would
        # navigate home and is deliberately not used here.
        await browser.ensure_ready()
        link = browser.page.locator('[data-testid="AppTabBar_Profile_Link"]')
        switcher = browser.page.locator('[data-testid="SideNav_AccountSwitcher_Button"]')
        await link.first.wait_for(state="visible", timeout=10000)
        if await link.count() != 1 or not await link.is_visible() or await switcher.count() != 1 or not await switcher.is_visible():
            raise SessionError("identity_not_ready")
        href = await link.get_attribute("href") or ""
        if not href:
            raise SessionError("identity_not_ready")
        location = urlsplit(urljoin("https://x.com", href))
        if (location.scheme != "https" or location.hostname not in {"x.com", "www.x.com"}
                or location.username or location.password or location.port or location.query or location.fragment):
            raise SessionError("ownership_mismatch")
        match = re.fullmatch(r"/([A-Za-z0-9_]{1,15})/?", location.path)
        label = " ".join((await switcher.inner_text()).split())
        if not match or match[1].lower() != ACCOUNT.lower():
            raise SessionError("ownership_mismatch")
        if not re.search(r"(?<![A-Za-z0-9_])@" + re.escape(ACCOUNT) + r"(?![A-Za-z0-9_])", label, re.I):
            raise SessionError("ownership_mismatch" if re.search(r"@[A-Za-z0-9_]{1,15}", label) else "identity_not_ready")
        return ACCOUNT

    async def reserve_owner_read():
        # Same bounded cooldown behavior as x-use ordinary reads. Retrying this
        # local reservation does not replay startup, navigation or DOM work.
        deadline = asyncio.get_running_loop().time() + 10
        for attempt in range(3):
            try:
                return ctx.safety_store.reserve(ACCOUNT, "read", None, {"manual": "owner_check"}, read_operation="ensure_ready")
            except PolicyError as error:
                wait = getattr(error, "retry_after_seconds", None)
                if (error.reason != "cooldown" or attempt == 2 or isinstance(wait, bool)
                        or not isinstance(wait, (int, float)) or wait <= 0
                        or wait > deadline - asyncio.get_running_loop().time()):
                    raise
                await asyncio.sleep(wait)
        raise RuntimeError("Owner reservation unavailable")

    @server.tool()
    async def manual_open(account: str, proxy_url: str, expected_ip: str, revision: str, session_id: str) -> dict:
        async with opening:
            if account != ACCOUNT or not re.fullmatch(r"[a-f0-9]{64}", revision):
                return {"ok": False, "reason": "fixed_account_required", **local_state()}
            if held["session_id"]:
                if held["revision"] != revision or held["expected_ip"] != expected_ip:
                    held["blocked"] = True
                return {"ok": local_state()["sessionState"] == "open", "reused": True, **local_state()}
            stage = "initial_open"
            try:
                _, raw, _ = resolve_account(ctx, ACCOUNT)
                require_active(raw, ACCOUNT)
                if ctx.safety_store is None:
                    raise RuntimeError("Existing x-use policy unavailable")
                ctx.safety_store.check_pause(ACCOUNT)
                # Only the authorized account's current effective relay changes,
                # in memory. No accounts file, active flag or Cookie is written.
                ctx.config_loader.accounts = [dict(a, proxy=proxy_url) if a.get("account_id") == ACCOUNT else a
                                              for a in ctx.config_loader.accounts]
                stage = "proxy_probe"
                result = await probe(account=ACCOUNT)
                if not result.get("ok") or result.get("egress_ip") != expected_ip:
                    raise SessionError("invalid_proxy")
                stage = "initial_ready"
                await browser_call(ctx, ACCOUNT, "ensure_ready", kind="read", recovery_read=False)
                # Acquire an already-established entry only; never silently cold
                # start again in the gap between readiness and the long lease.
                existing = ctx.session_pool.entry_for(ACCOUNT)
                if existing is None or existing.closing:
                    raise SessionError("session_expired")
                held.update(session_id=session_id, revision=revision, expected_ip=expected_ip,
                            release=asyncio.Event(), ready=asyncio.Event())
                held["task"] = asyncio.create_task(lease())
                await held["ready"].wait()
                if held["task"].done():
                    held["task"].result()
                    raise SessionError("session_expired")
                if ctx.session_pool.entry_for(ACCOUNT) is not existing:
                    raise SessionError("session_expired")
                stage = "owner_ready"
                action_id = await reserve_owner_read()
                try:
                    held["owner"] = await owner_from_current_page(held["entry"])
                except BaseException:
                    ctx.safety_store.finish(ACCOUNT, action_id, "failed")
                    raise
                ctx.safety_store.finish(ACCOUNT, action_id, "succeeded")
                return {"ok": True, "reused": False, **local_state()}
            except BaseException as error:
                if isinstance(error, asyncio.CancelledError):
                    raise
                # Initialization failures keep their prior conservative terminal
                # lifecycle; this patch adds no new initialization retry entry.
                return failure(error, stage, initial=True)

    @server.tool()
    async def manual_open_post(account: str, revision: str, expected_ip: str, session_id: str, target_url: str) -> dict:
        async with opening:
            stage, action_id = "binding", None
            try:
                if account != ACCOUNT or revision != held["revision"] or expected_ip != held["expected_ip"] or session_id != held["session_id"]:
                    raise SessionError("binding_mismatch")
                if not re.fullmatch(r"https://x\.com/[A-Za-z0-9_]{1,15}/status/[0-9]{5,30}", target_url):
                    raise SessionError("invalid_target")
                state = local_state()
                if state["sessionState"] != "open":
                    return {"ok": False, "reason": "existing_session_required", "stage": stage,
                            "failureCategory": "closed" if state["sessionState"] == "closed" else "blocked", **state}
                _, raw, _ = resolve_account(ctx, ACCOUNT)
                require_active(raw, ACCOUNT)
                ctx.safety_store.check_pause(ACCOUNT)
                existing = ctx.session_pool.entry_for(ACCOUNT)
                if existing is None or existing.closing or existing.browser_manager is not held["entry"]:
                    raise SessionError("session_expired")
                stage = "policy"
                action_id = ctx.safety_store.reserve(ACCOUNT, "read", None,
                    {"manual": "open_post"}, read_operation="navigate")
                stage = "owner_before"
                await owner_from_current_page(held["entry"])
                stage = "navigate"
                await held["entry"].navigate(target_url)
                stage = "owner_after"
                held["owner"] = await owner_from_current_page(held["entry"])
                ctx.safety_store.finish(ACCOUNT, action_id, "succeeded")
                return {"ok": True, "reused": True, **local_state()}
            except BaseException as error:
                if action_id:
                    try:
                        ctx.safety_store.finish(ACCOUNT, action_id, "failed")
                    except Exception:
                        pass  # Preserve the original platform/identity failure classification.
                if isinstance(error, asyncio.CancelledError):
                    raise
                return failure(error, stage)

    @server.tool()
    async def local_status() -> dict:
        return {"ok": True, "capability": CAPABILITY, **local_state()}

    @server.tool()
    async def manual_end(account: str) -> dict:
        if account != ACCOUNT:
            return {"ok": False, "reason": "fixed_account_required"}
        if held["release"]:
            held["release"].set()
        if held["task"]:
            await held["task"]
        await ctx.session_pool.close(ACCOUNT)
        return {"ok": True, "closed": True}

    return server


def main():
    from xuse.mcp.stdio import enforce_stdio_stdout_hygiene
    from xuse.mcp.ownership import server_home_lock
    from xuse.core.config_loader import PROJECT_ROOT
    enforce_stdio_stdout_hygiene()
    with server_home_lock(PROJECT_ROOT):
        restricted_server().run()


if __name__ == "__main__":
    main()
