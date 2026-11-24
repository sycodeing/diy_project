"""Independent manual window helper. No x-use, auto worker, Cookie import or X automation.

Startup only registers this boot and polls the manual-only API. A fresh explicit
admin request can open the bound Chrome profile at an IP check URL. The user
alone navigates its retained tab to X and performs every login/upload/send.
"""
from __future__ import annotations

import asyncio
import fcntl
import ipaddress
import json
import os
import signal
import subprocess
import time
import uuid
from contextlib import AsyncExitStack
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

HELPER_ID = "macbook-account-manual-01"
ACCOUNT_ID = "648f2feb-3820-4306-8192-184444ef7cb8"
ACCOUNT_KEY = "Le6wCummeratawi"
CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
IP_CHECK_URL = "https://api.ipify.org?format=json"


def request_is_current(request: dict[str, Any], boot_id: str, booted_at: str, now: float | None = None) -> bool:
    try:
        stamp = lambda value: datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
        current = time.time() if now is None else now
        return (request.get("bootId") == boot_id and request.get("accountId") == ACCOUNT_ID
                and request.get("accountKey") == ACCOUNT_KEY
                and stamp(request["createdAt"]) >= stamp(booted_at)
                and stamp(request["expiresAt"]) > current
                and len(str(request.get("routeRevision", ""))) == 64)
    except (ValueError, KeyError, TypeError):
        return False


@dataclass
class NativeSession:
    account_id: str
    revision: str
    session_id: str
    expected_ip: str
    process: Any
    resources: AsyncExitStack


class NativeManualSessions:
    def __init__(self, state_dir: Path, *, launcher: Callable[..., Any] = subprocess.Popen,
                 proxy_factory: Callable[..., Any] | None = None, chrome: Path = CHROME):
        self.state_dir, self.launcher, self.proxy_factory, self.chrome = state_dir, launcher, proxy_factory, chrome
        self.session: NativeSession | None = None
        self.blocked = False

    def has_live_window(self) -> bool:
        return self.session is not None and self.session.process.poll() is None

    def heartbeat_session(self) -> dict[str, str]:
        if not self.session:
            return {"sessionState": "blocked" if self.blocked else "idle"}
        state = "blocked" if self.blocked else "open" if self.has_live_window() else "closed"
        return {"sessionState": state, "sessionId": self.session.session_id,
                "routeRevision": self.session.revision, "expectedIp": self.session.expected_ip}

    async def open_ip_window(self, request: dict[str, Any]) -> dict[str, str]:
        """Only called for an explicit, unexpired request. Never navigates an existing tab."""
        if request.get("accountId") != ACCOUNT_ID or request.get("accountKey") != ACCOUNT_KEY:
            return {"status": "blocked", "message": "固定账号不匹配，未打开窗口。"}
        try:
            ipaddress.ip_address(str(request["expectedIp"]))
        except (ValueError, KeyError):
            return {"status": "blocked", "message": "预期出口无效，未打开窗口。"}
        revision = str(request.get("routeRevision", ""))
        if self.blocked:
            return {"status": "blocked", "message": "本助手会话已阻断，不会自动重开或切换网络。"}
        if self.session:
            if self.session.account_id != ACCOUNT_ID or self.session.revision != revision or self.session.expected_ip != request["expectedIp"]:
                self.blocked = True
                return {"status": "blocked", "message": "绑定已变化；保留原窗口和连接，不切网或重建。"}
            if not self.has_live_window():
                self.blocked = True
                return {"status": "blocked", "message": "原绑定窗口已关闭，请本人结束助手并显式重新启动后再请求；未自动重开。"}
            return {"status": "opened_manual_check", "sessionId": self.session.session_id,
                    "message": "已有绑定窗口保持不变；请本人核对。未刷新、导航或新建标签。"}
        if not self.chrome.is_file():
            return {"status": "failed", "message": "未找到标准 Google Chrome；不会改用 Testing 浏览器。"}
        profile = self.state_dir / "profiles" / ACCOUNT_ID
        profile.mkdir(parents=True, exist_ok=True, mode=0o700)
        marker = profile.parent / f"{ACCOUNT_ID}.session.json"
        if (profile / "SingletonLock").exists() or (profile / "SingletonLock").is_symlink():
            self.blocked = True
            return {"status": "blocked", "message": "独立资料目录仍被浏览器占用，本助手不会接管或重开。"}
        if marker.exists():
            previous = json.loads(marker.read_text())
            if previous.get("routeRevision") != revision:
                self.blocked = True
                return {"status": "blocked", "message": "持久资料目录的原绑定已变化；须人工核对，不会换网接管。"}
            try:
                os.kill(int(previous["pid"]), 0)
            except (OSError, ValueError, KeyError):
                pass
            else:
                self.blocked = True
                return {"status": "blocked", "message": "上一助手的持久窗口仍在；本次不会接管或重开。请本人核对旧窗口。"}
        resources = AsyncExitStack()
        try:
            # Import and start the proxy bridge only here, never at startup/heartbeat.
            if self.proxy_factory is None:
                from .proxy_bridge import browser_compatible_proxy
                factory = browser_compatible_proxy
            else:
                factory = self.proxy_factory
            upstream = str(request.get("proxyUrl") or "")
            parsed = urlsplit(upstream)
            if parsed.scheme not in {"http", "https", "socks5"} or not parsed.hostname or not parsed.port:
                raise ValueError("invalid bound proxy")
            effective = await resources.enter_async_context(factory(upstream))
            native_proxy = urlsplit(str(effective))
            if native_proxy.scheme not in {"http", "https", "socks5"} or not native_proxy.hostname or not native_proxy.port or native_proxy.username or native_proxy.password:
                raise ValueError("proxy unsupported by native Chrome")
            # Standard Chrome and a private persistent profile. No CDP, Patchright,
            # automation flags, JavaScript, Cookie loading or target X URL.
            process = self.launcher([str(self.chrome), f"--user-data-dir={profile}", f"--proxy-server={effective}",
                                     "--proxy-bypass-list=<-loopback>", IP_CHECK_URL],
                                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            session_id = str(uuid.uuid4())
            self.session = NativeSession(ACCOUNT_ID, revision, session_id, str(request["expectedIp"]), process, resources)
            marker.write_text(json.dumps({"pid": process.pid, "routeRevision": revision, "sessionId": session_id}))
            os.chmod(marker, 0o600)
            if process.poll() is not None:
                raise RuntimeError("owned Chrome exited")
            return {"status": "opened_manual_check", "sessionId": session_id,
                    "message": "已按固定配置打开独立持久 Chrome 的 IP 核对页；出口和账号须本人核对，未打开 X。"}
        except Exception:
            if not self.has_live_window():
                await resources.aclose()
            self.blocked = True
            return {"status": "failed", "message": "独立绑定窗口启动失败；没有直连回退或自动重试。"}

    async def release_after_user_closed(self) -> None:
        """Never close a user window. Release relay only once the owned process ended."""
        if self.session and not self.has_live_window():
            await self.session.resources.aclose()


async def run_helper(site_url: str, secret: str, state_dir: Path) -> None:
    import httpx
    boot_id = str(uuid.uuid4())
    sessions = NativeManualSessions(state_dir)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    endpoint = f"{site_url.rstrip('/')}/api/x-account-manual/helper"
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        async def call(operation: str, **values: Any):
            return await client.post(endpoint, headers={"Authorization": f"Bearer {secret}"},
                json={"operation": operation, "helperId": HELPER_ID, "bootId": boot_id, **values})
        response = await call("register")
        response.raise_for_status()
        booted_at = str(response.json()["bootedAt"])
        print("Manual-only helper online. No browser, proxy or X access occurs until a fresh explicit IP-window request.", flush=True)
        try:
            while not stop.is_set():
                try:
                    heartbeat = await call("heartbeat", **sessions.heartbeat_session())
                    if heartbeat.status_code == 409:
                        stop.set(); break
                    heartbeat.raise_for_status()
                    response = await call("claim")
                    response.raise_for_status()
                    if response.status_code != 204:
                        request = response.json().get("request", {})
                        if request_is_current(request, boot_id, booted_at):
                            result = await sessions.open_ip_window(request)
                        else:
                            sessions.blocked = True
                            result = {"status": "blocked", "message": "请求不属于当前启动或已过期，未打开窗口。"}
                        if request.get("id"):
                            complete = await call("complete", requestId=request["id"], **result)
                            complete.raise_for_status()
                except Exception:
                    # Never print response bodies, proxy credentials or local browser paths.
                    print("Manual helper request failed; no automatic browser retry.", flush=True)
                try:
                    await asyncio.wait_for(stop.wait(), timeout=5)
                except asyncio.TimeoutError:
                    pass
        finally:
            try:
                await call("stop")
            except Exception:
                pass
            # Stop new requests immediately while preserving a user's live window
            # and its required relay until that user closes their owned Chrome.
            if sessions.has_live_window():
                print("Requests stopped. Keeping the owned window route alive until you close that window.", flush=True)
            while sessions.has_live_window():
                await asyncio.sleep(1)
            await sessions.release_after_user_closed()


def main() -> None:
    from dotenv import load_dotenv
    # Read local service settings only, never X credentials or browser storage.
    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
    site = os.environ.get("DIY_SITE_URL", "https://www.thebestdiyshop.com")
    if site != "https://www.thebestdiyshop.com":
        raise SystemExit("Manual helper site must be the configured production site.")
    secret = os.environ.get("X_REPLY_WORKER_SECRET", "")
    if len(secret) < 32:
        raise SystemExit("Local manual helper credentials are not configured.")
    state = Path.home() / "Library" / "Application Support" / "DiyProject" / "account-manual-helper"
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / "helper.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("A manual-only helper is already running.") from None
        asyncio.run(run_helper(site, secret, state))


if __name__ == "__main__":
    main()
