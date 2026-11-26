"""Lazy owner of one restricted x-use stdio session and its original route."""
from __future__ import annotations

import asyncio
import uuid
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any

ACCOUNT_ID = "648f2feb-3820-4306-8192-184444ef7cb8"
ACCOUNT_KEY = "Le6wCummeratawi"


class XUseManualSessions:
    def __init__(self, x_use_home: Path):
        # No ConfigLoader, x-use imports, MCP, Cookie or proxy work at startup.
        self.x_use_home = x_use_home
        self.resources: AsyncExitStack | None = None
        self.client: Any = None
        self.state: dict[str, Any] = {"sessionState": "idle", "live": False}
        self.blocked = False
        self.ever_attempted = False

    def has_live_window(self):
        return bool(self.state.get("live"))

    def can_renew_idle_heartbeat(self):
        return (not self.ever_attempted and not self.blocked and self.client is None
                and self.resources is None and self.state.get("sessionState") == "idle"
                and not self.state.get("sessionId") and not self.has_live_window())

    def heartbeat_session(self):
        values = {k: self.state[k] for k in ("sessionId", "routeRevision", "expectedIp", "ownerHandle") if self.state.get(k)}
        if self.can_renew_idle_heartbeat():
            values["idleNeverStarted"] = True
        return {"sessionState": "closed" if self.state.get("sessionState") == "closed" else "blocked" if self.blocked else self.state.get("sessionState", "idle"), **values}

    async def poll_local_status(self):
        if not self.client:
            return
        try:
            data = await self._call("local_status", {})
            if not data.get("ok"):
                raise RuntimeError("Local x-use status unavailable")
            self.state = data
            self.blocked = self.blocked or data.get("sessionState") in {"blocked", "closed"}
        except Exception:
            # A backend/transport error is not proof a user window disappeared.
            # Keep the last live lease and relay, latch blocked, never recreate.
            self.blocked = True

    async def _call(self, name, args):
        from .xuse_client import _payload
        return _payload(await asyncio.wait_for(self.client.call_tool(name, args), timeout=180))

    async def open_home(self, request):
        if request.get("accountId") != ACCOUNT_ID or request.get("accountKey") != ACCOUNT_KEY:
            return {"status": "blocked", "message": "固定账号不匹配，未启动 x-use。"}
        revision, expected = request.get("routeRevision"), request.get("expectedIp")
        if self.client:
            await self.poll_local_status()
            if self.state.get("routeRevision") != revision or self.state.get("expectedIp") != expected:
                self.blocked = True
            if self.blocked or self.state.get("sessionState") != "open":
                return {"status": "blocked", "message": "已有 x-use 会话已阻断或绑定变化；保留现场，不重开。"}
            return self._opened("已复用同一 x-use 绑定会话；未导航、刷新或创建标签。")
        if self.blocked:
            return {"status": "blocked", "message": "本次助手已阻断，不自动重试。"}
        self.ever_attempted = True
        resources = AsyncExitStack()
        self.resources = resources
        open_attempted = False
        try:
            # These imports and every resource-producing await occur only for
            # a fresh explicit request, never from registration or heartbeat.
            from mcp import ClientSession
            from mcp.client.stdio import stdio_client
            from .proxy_bridge import browser_compatible_proxy
            from .xuse_client import _server_parameters
            effective = await resources.enter_async_context(browser_compatible_proxy(request.get("proxyUrl")))
            parameters, _ = _server_parameters(self.x_use_home)
            parameters.args = [str(Path(__file__).with_name("account_manual_mcp_bootstrap.py"))]
            log_dir = self.x_use_home / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            errors = resources.enter_context((log_dir / "account-manual-mcp-stderr.log").open("a", encoding="utf-8"))
            read, write = await resources.enter_async_context(stdio_client(parameters, errlog=errors))
            self.client = await resources.enter_async_context(ClientSession(read, write))
            await asyncio.wait_for(self.client.initialize(), timeout=45)
            open_attempted = True
            data = await self._call("manual_open", {"account": ACCOUNT_KEY, "proxy_url": effective,
                "expected_ip": expected, "revision": revision, "session_id": str(uuid.uuid4())})
            self.state = data
            if not data.get("ok") or data.get("ownerHandle") != ACCOUNT_KEY or data.get("expectedIp") != expected:
                self.blocked = True
                return {"status": "blocked", "message": "x-use 账号、出口或会话核对失败；不重试、不恢复暂停。初始化失败可能由原池关闭窗口。"}
            return self._opened("已由 x-use 使用原绑定链打开首页，并核对出口及可见登录账号；请本人复核后操作。")
        except Exception:
            self.blocked = True
            # Before manual_open is sent there can be no owned browser. Release
            # failed stdio/initialization resources instead of retaining a ghost.
            if not open_attempted:
                await resources.aclose()
                self.resources = self.client = None
                self.state = {"sessionState": "blocked", "live": False}
            elif self.client:
                # Unknown open outcome: preserve a possibly visible page/relay.
                self.state["live"] = True
            return {"status": "blocked", "message": "x-use 手动入口未确认就绪；不会另建会话或重试。"}

    async def open_post(self, request):
        # A post request never creates a new MCP/context or imports Cookies.
        import re
        target = request.get("targetPostUrl")
        if not isinstance(target, str) or not re.fullmatch(r"https://x\.com/[A-Za-z0-9_]{1,15}/status/[0-9]{5,30}", target):
            return {"status": "blocked", "message": "目标帖子链接无效；未导航。"}
        if not self.client:
            return {"status": "blocked", "message": "无法接管已有窗口：本助手未持有其原 context；不会另建 Cookie 会话。请保留原窗口。"}
        result = await self.open_home(request)
        if result.get("status") != "opened_x_home":
            return result
        try:
            data = await self._call("manual_open_post", {"account": ACCOUNT_KEY,
                "revision": request.get("routeRevision"), "expected_ip": request.get("expectedIp"),
                "session_id": self.state.get("sessionId"), "target_url": request.get("targetPostUrl")})
            self.state = data
            if not data.get("ok"):
                self.blocked = True
                return {"status": "blocked", "message": "原 x-use 会话无法安全打开目标；保留窗口，不重试或另建会话。"}
            return {**self._opened("已在原 x-use context 的同一标签打开目标帖子；请本人复核，未发送。"), "status": "opened_x_post"}
        except Exception:
            self.blocked = True
            return {"status": "blocked", "message": "目标打开结果未确认；保留原会话，不重试。"}

    def _opened(self, message):
        return {"status": "opened_x_home", "sessionId": self.state["sessionId"],
                "ownerHandle": self.state["ownerHandle"], "egressIp": self.state["expectedIp"], "message": message}

    async def release_after_user_closed(self):
        if self.resources and not self.has_live_window():
            if self.client:
                try:
                    await self._call("manual_end", {"account": ACCOUNT_KEY})
                except Exception:
                    pass
            await self.resources.aclose()
            self.resources = self.client = None
