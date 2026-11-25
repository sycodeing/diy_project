"""Restricted stdio adapter around the installed x-use runtime.

Only a fresh explicit web request starts this process. Browser construction,
Cookie loading, readiness, policy and transport remain owned by x-use.
"""
from __future__ import annotations

import asyncio
import re
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
                            "blocked": False, "session_id": None, "revision": None,
                            "expected_ip": None, "owner": None}
    opening = asyncio.Lock()

    def local_state():
        metadata = ctx.session_pool.session_status(ACCOUNT)
        live = bool(metadata.get("warm") and metadata.get("browser_connected") is not False
                    and metadata.get("tab_closed") is not True)
        state = "closed" if held["session_id"] and metadata.get("tab_closed") is True else "blocked" if held["blocked"] else "open" if live and held["entry"] else "closed" if held["session_id"] else "idle"
        return {"sessionState": state, "live": live, "sessionId": held["session_id"],
                "routeRevision": held["revision"], "expectedIp": held["expected_ip"],
                "ownerHandle": held["owner"], "transport": metadata}

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
        await browser.check_blocked()
        link = browser.page.locator('[data-testid="AppTabBar_Profile_Link"]')
        switcher = browser.page.locator('[data-testid="SideNav_AccountSwitcher_Button"]')
        if await link.count() != 1 or not await link.is_visible() or await switcher.count() != 1 or not await switcher.is_visible():
            raise SessionError("ownership_unverified")
        href = await link.get_attribute("href") or ""
        location = urlsplit(urljoin("https://x.com", href))
        if (location.scheme != "https" or location.hostname not in {"x.com", "www.x.com"}
                or location.username or location.password or location.port or location.query or location.fragment):
            raise SessionError("ownership_unverified")
        match = re.fullmatch(r"/([A-Za-z0-9_]{1,15})/?", location.path)
        label = " ".join((await switcher.inner_text()).split())
        if not match or match[1].lower() != ACCOUNT.lower() or not re.search(r"(?<![A-Za-z0-9_])@" + re.escape(ACCOUNT) + r"(?![A-Za-z0-9_])", label, re.I):
            raise SessionError("ownership_unverified")
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
                result = await probe(account=ACCOUNT)
                if not result.get("ok") or result.get("egress_ip") != expected_ip:
                    raise SessionError("invalid_proxy")
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
                action_id = await reserve_owner_read()
                try:
                    held["owner"] = await owner_from_current_page(held["entry"])
                except BaseException:
                    ctx.safety_store.finish(ACCOUNT, action_id, "failed")
                    ctx.safety_store.pause(ACCOUNT, "manual_pause", preserve_manual=True)
                    raise
                ctx.safety_store.finish(ACCOUNT, action_id, "succeeded")
                return {"ok": True, "reused": False, **local_state()}
            except BaseException as error:
                held["blocked"] = True
                if isinstance(error, BrowserBlocked):
                    ctx.safety_store.pause(ACCOUNT, error.reason, preserve_manual=True)
                if isinstance(error, asyncio.CancelledError):
                    raise
                # Preserve a warm leased page for the operator. Cold-start errors
                # retain the official pool's cleanup behavior; no fake promise.
                return {"ok": False, "reason": getattr(error, "reason", "manual_open_failed"), **local_state()}

    @server.tool()
    async def manual_open_post(account: str, revision: str, expected_ip: str, session_id: str, target_url: str) -> dict:
        async with opening:
            if (account != ACCOUNT or not re.fullmatch(r"https://x\.com/[A-Za-z0-9_]{1,15}/status/[0-9]{5,30}", target_url)
                    or session_id != held["session_id"] or revision != held["revision"]
                    or expected_ip != held["expected_ip"] or local_state()["sessionState"] != "open"):
                return {"ok": False, "reason": "existing_session_required", **local_state()}
            action_id = None
            try:
                _, raw, _ = resolve_account(ctx, ACCOUNT)
                require_active(raw, ACCOUNT)
                ctx.safety_store.check_pause(ACCOUNT)
                # The long lease already owns this pool entry. Calling the
                # ordinary pool wrapper here would deadlock or allow cold start.
                if ctx.session_pool.entry_for(ACCOUNT).browser_manager is not held["entry"]:
                    raise SessionError("session_expired")
                action_id = ctx.safety_store.reserve(ACCOUNT, "read", None,
                    {"manual": "open_post"}, read_operation="navigate")
                await owner_from_current_page(held["entry"])
                await held["entry"].navigate(target_url)
                held["owner"] = await owner_from_current_page(held["entry"])
                ctx.safety_store.finish(ACCOUNT, action_id, "succeeded")
                return {"ok": True, "reused": True, **local_state()}
            except BaseException as error:
                held["blocked"] = True
                if action_id:
                    ctx.safety_store.finish(ACCOUNT, action_id, "failed")
                if isinstance(error, BrowserBlocked):
                    ctx.safety_store.pause(ACCOUNT, error.reason, preserve_manual=True)
                elif not isinstance(error, PolicyError):
                    ctx.safety_store.pause(ACCOUNT, "manual_pause", preserve_manual=True)
                if isinstance(error, asyncio.CancelledError):
                    raise
                return {"ok": False, "reason": getattr(error, "reason", "post_open_failed"), **local_state()}

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
