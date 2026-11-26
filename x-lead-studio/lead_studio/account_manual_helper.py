"""Idle manual helper; only fresh user requests enter the restricted x-use runtime.

Startup reads backend settings only. No automatic worker, send, approval,
Cookie save, proxy probe or X navigation occurs from heartbeat or polling.
"""
from __future__ import annotations

import asyncio
import fcntl
import json
import os
import signal
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HELPER_ID = "macbook-account-manual-01"
ACCOUNT_ID = "648f2feb-3820-4306-8192-184444ef7cb8"
ACCOUNT_KEY = "Le6wCummeratawi"
CAPABILITY = "xuse-manual-read-v3"
HEARTBEAT_SECONDS = 5


def request_is_current(request: dict[str, Any], boot_id: str, booted_at: str, now: float | None = None) -> bool:
    try:
        stamp = lambda value: datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
        current = time.time() if now is None else now
        return (request.get("bootId") == boot_id and request.get("accountId") == ACCOUNT_ID
                and request.get("accountKey") == ACCOUNT_KEY
                and request.get("purpose") in {"account_x_home", "manual_task_x_home", "manual_task_x_post"}
                and ((request.get("purpose") == "account_x_home" and request.get("taskId") is None)
                     or (request.get("purpose") in {"manual_task_x_home", "manual_task_x_post"} and bool(request.get("taskId"))))
                and stamp(request["createdAt"]) >= stamp(booted_at)
                and stamp(request["expiresAt"]) > current
                and len(str(request.get("routeRevision", ""))) == 64)
    except (ValueError, KeyError, TypeError):
        return False


async def run_helper(site_url: str, secret: str, state_dir: Path, x_use_home: Path | None = None) -> None:
    import httpx
    boot_id = str(uuid.uuid4())
    from .account_manual_xuse import XUseManualSessions
    sessions = XUseManualSessions(x_use_home or Path.home() / "Library" / "Application Support" / "x-use")
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    stop_reason = "operator_stop"
    def request_stop(reason):
        nonlocal stop_reason
        stop_reason = reason
        stop.set()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, request_stop, "signal_stop")
    endpoint = f"{site_url.rstrip('/')}/api/x-account-manual/helper"
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        async def call(operation: str, **values: Any):
            return await client.post(endpoint, headers={"Authorization": f"Bearer {secret}"},
                json={"operation": operation, "helperId": HELPER_ID, "bootId": boot_id, "capability": CAPABILITY, **values})
        response = await call("register")
        response.raise_for_status()
        booted_at = str(response.json()["bootedAt"])
        print("Manual x-use helper online. No MCP, account config, browser or bound proxy starts before a fresh explicit request.", flush=True)
        backend_ready = asyncio.Event()
        last_success = 0.0
        async def keep_heartbeat():
            nonlocal last_success
            while not stop.is_set():
                try:
                    # Cached lifecycle data only: never wait for MCP/DOM while
                    # keeping the independent backend lease alive.
                    heartbeat = await call("heartbeat", **sessions.heartbeat_session())
                    if heartbeat.status_code == 409:
                        request_stop("backend_boot_expired")
                        return
                    heartbeat.raise_for_status()
                    last_success = time.time()
                    backend_ready.set()
                except Exception:
                    backend_ready.clear()
                    print("Manual helper heartbeat unavailable; no browser retry.", flush=True)
                    if not sessions.can_renew_idle_heartbeat() and time.time() - last_success >= 40:
                        request_stop("heartbeat_unavailable")
                        return
                try:
                    await asyncio.wait_for(stop.wait(), timeout=HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    pass
        heartbeat_task = asyncio.create_task(keep_heartbeat())
        await asyncio.sleep(0)
        try:
            while not stop.is_set():
                try:
                    await sessions.poll_local_status()
                    if not backend_ready.is_set() or time.time() - last_success >= 40:
                        try:
                            await asyncio.wait_for(stop.wait(), timeout=HEARTBEAT_SECONDS)
                        except asyncio.TimeoutError:
                            pass
                        continue
                    if stop.is_set():
                        break
                    response = await call("claim")
                    response.raise_for_status()
                    if response.status_code != 204:
                        request = response.json().get("request", {})
                        if stop.is_set() or not backend_ready.is_set() or time.time() - last_success >= 40:
                            result = {"status": "blocked", "message": "助手已停止接收请求；未开始打开窗口或导航。"}
                        elif request_is_current(request, boot_id, booted_at):
                            result = await sessions.open_post(request) if request.get("purpose") == "manual_task_x_post" else await sessions.open_home(request)
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
                    await asyncio.wait_for(stop.wait(), timeout=HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    pass
        finally:
            stop.set()
            await heartbeat_task
            print(f"Manual helper stopped accepting requests: {stop_reason}.", flush=True)
            try:
                await call("stop", **sessions.heartbeat_session())
            except Exception:
                pass
            # Stop new requests immediately while preserving a user's live window
            # and its required relay until that user closes their x-use page.
            if sessions.has_live_window():
                print("Requests stopped. Keeping the x-use session route alive until the user closes its page.", flush=True)
            while sessions.has_live_window():
                await asyncio.sleep(1)
                await sessions.poll_local_status()
            await sessions.release_after_user_closed()
            try:
                await call("stop", **sessions.heartbeat_session())
            except Exception:
                pass


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
        asyncio.run(run_helper(site, secret, state, Path(os.environ.get("X_USE_HOME", str(Path.home() / "Library" / "Application Support" / "x-use")))))


if __name__ == "__main__":
    main()
