from __future__ import annotations

import asyncio
import importlib.util
import ipaddress
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable


NETWORK_MODES = {"vpn_direct", "fixed_proxy"}
IP_CHECK_FALLBACK_URLS = (
    "https://api64.ipify.org?format=json",
    "https://ifconfig.me/ip",
    "https://icanhazip.com",
    "https://checkip.amazonaws.com",
)


@dataclass(frozen=True)
class ReplyResult:
    status: str
    draft_id: str | None = None
    action_id: str | None = None
    result_url: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    egress_ip: str | None = None


@dataclass(frozen=True)
class NetworkProbeResult:
    ok: bool
    egress_ip: str | None = None
    error_code: str | None = None
    error_message: str | None = None


@dataclass(frozen=True)
class AccountMappingVerificationResult:
    ok: bool
    actual_handle: str | None = None
    egress_ip: str | None = None
    error_code: str | None = None
    error_message: str | None = None


def xuse_is_installed() -> bool:
    return importlib.util.find_spec("xuse") is not None and importlib.util.find_spec("mcp") is not None


def configured_account_keys(x_use_home: Path) -> list[str]:
    path = x_use_home / "config" / "accounts.json"
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return []
    configured: list[str] = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or not row.get("is_active", True):
            continue
        account_id = row.get("account_id")
        if not isinstance(account_id, str) or not account_id:
            continue
        cookie_path = row.get("cookie_file_path")
        has_inline_cookies = isinstance(row.get("cookies"), list) and bool(row["cookies"])
        has_cookie_file = False
        if isinstance(cookie_path, str) and cookie_path:
            candidate = Path(cookie_path)
            if not candidate.is_absolute():
                candidates = [x_use_home / candidate, x_use_home / "config" / candidate]
                has_cookie_file = any(item.is_file() for item in candidates)
            else:
                has_cookie_file = candidate.is_file()
        if has_inline_cookies or has_cookie_file:
            configured.append(account_id)
    return sorted(set(configured))


def configured_account_proxy(x_use_home: Path, account_id: str) -> str | None:
    path = x_use_home / "config" / "accounts.json"
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and row.get("account_id") == account_id:
            value = row.get("proxy")
            return value if isinstance(value, str) and value else None
    return None


def _payload(result: Any) -> dict[str, Any]:
    structured = getattr(result, "structuredContent", None)
    if isinstance(structured, dict):
        value = structured.get("result", structured)
        if isinstance(value, dict):
            return value
    for block in getattr(result, "content", []):
        text = getattr(block, "text", None)
        if isinstance(text, str):
            try:
                value = json.loads(text)
            except ValueError:
                continue
            if isinstance(value, dict):
                return value
    return {"ok": False, "error": {"type": "invalid_response", "message": "x-use returned no structured result."}}


def _redact_sensitive(value: str) -> str:
    value = re.sub(r"(?i)\b(https?|socks5h?)://[^\s/@]+:[^\s/@]+@", r"\1://***:***@", value)
    value = re.sub(r"(?i)(authorization\s*[:=]\s*bearer\s+)[^\s]+", r"\1***", value)
    value = re.sub(r"(?i)((?:set-)?cookie\s*[:=]\s*)[^\r\n]+", r"\1***", value)
    value = re.sub(r"(?i)\b(auth_token|ct0)=([^;\s]+)", r"\1=***", value)
    return value[:1000]


def _approval_failure_status(error_code: str, action_id: str | None) -> str:
    return "uncertain" if action_id or error_code in {"send_unconfirmed", "draft_journal_failure", "already_executed"} else "failed"


def _error_fields(payload: dict[str, Any]) -> tuple[str, str, str | None]:
    error = payload.get("error")
    if not isinstance(error, dict):
        return "xuse_error", "x-use operation failed.", None
    code = str(error.get("reason") or error.get("type") or "xuse_error")[:100]
    message = _redact_sensitive(str(error.get("message") or "x-use operation failed."))
    action_id = error.get("action_id")
    return code, message, str(action_id)[:160] if action_id else None


def _first_x_url(value: Any) -> str | None:
    if isinstance(value, str) and value.startswith(("https://x.com/", "https://www.x.com/", "https://twitter.com/")):
        return value
    if isinstance(value, dict):
        for key in ("tweet_url", "reply_url", "url", "permalink", "evidence", "result"):
            found = _first_x_url(value.get(key))
            if found:
                return found
    return None


def _extract_ip(value: Any) -> str | None:
    candidates: list[Any] = []
    if isinstance(value, dict):
        candidates.extend(value.get(key) for key in ("ip", "query", "address", "egress_ip"))
    candidates.append(value)
    for candidate in candidates:
        if not isinstance(candidate, str):
            continue
        try:
            return str(ipaddress.ip_address(candidate.strip()))
        except ValueError:
            continue
    return None


async def probe_direct_egress(ip_check_url: str) -> NetworkProbeResult:
    """Probe the real browser route without loading cookies or visiting X."""
    try:
        from patchright.async_api import async_playwright

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=False)
            try:
                context = await browser.new_context()
                urls = list(dict.fromkeys((ip_check_url, *IP_CHECK_FALLBACK_URLS)))
                errors: list[str] = []
                for url in urls:
                    page = await context.new_page()
                    try:
                        await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
                        body = (await page.text_content("body") or "").strip()
                        try:
                            decoded: Any = json.loads(body)
                        except ValueError:
                            decoded = body
                        egress_ip = _extract_ip(decoded)
                        if egress_ip:
                            return NetworkProbeResult(True, egress_ip=egress_ip)
                        errors.append(f"{url}: invalid IP response")
                    except Exception as error:
                        errors.append(f"{url}: {type(error).__name__}")
                    finally:
                        await page.close()
            finally:
                await browser.close()
        return NetworkProbeResult(
            False,
            error_code="browser_ip_unconfirmed",
            error_message=_redact_sensitive(f"Patchright browser could not confirm its egress IP ({'; '.join(errors)})."),
        )
    except Exception as error:
        return NetworkProbeResult(
            False,
            error_code="browser_probe_failed",
            error_message=_redact_sensitive(f"{type(error).__name__}: {error}"),
        )


async def _probe_fixed_proxy(session: Any, *, x_use_home: Path, account: str, proxy_url: str | None) -> NetworkProbeResult:
    if not proxy_url:
        return NetworkProbeResult(False, error_code="proxy_required", error_message="The fixed_proxy account has no dedicated route; direct fallback is forbidden.")
    if configured_account_proxy(x_use_home, account) != proxy_url:
        update_call = await asyncio.wait_for(
            session.call_tool("update_account", {"account": account, "proxy": proxy_url}),
            timeout=45,
        )
        update_result = _payload(update_call)
        if not update_result.get("ok"):
            code, message, _ = _error_fields(update_result)
            return NetworkProbeResult(False, error_code=code, error_message=message)

    proxy_call = await asyncio.wait_for(session.call_tool("test_proxy", {"account": account}), timeout=120)
    proxy_result = _payload(proxy_call)
    if not proxy_result.get("ok"):
        code, message, _ = _error_fields(proxy_result)
        return NetworkProbeResult(False, error_code=code, error_message=message)
    egress_ip = _extract_ip(proxy_result.get("egress_ip"))
    if not egress_ip:
        return NetworkProbeResult(False, error_code="proxy_ip_unconfirmed", error_message="The fixed proxy did not return a confirmed egress IP; direct fallback is forbidden.")
    return NetworkProbeResult(True, egress_ip=egress_ip)


def _server_parameters(x_use_home: Path) -> tuple[Any, dict[str, str]]:
    from mcp import StdioServerParameters

    environment = dict(os.environ, X_USE_HOME=str(x_use_home), PYTHONUTF8="1", PYTHONNOUSERSITE="1")
    environment.pop("PYTHONPATH", None)
    parameters = StdioServerParameters(
        command=sys.executable,
        args=["-m", "xuse.mcp.server"],
        cwd=str(x_use_home),
        env=environment,
    )
    return parameters, environment


async def probe_network_route(
    *,
    x_use_home: Path,
    account: str,
    network_mode: str,
    proxy_url: str | None,
    ip_check_url: str,
) -> NetworkProbeResult:
    if network_mode not in NETWORK_MODES:
        return NetworkProbeResult(False, error_code="invalid_network_mode", error_message="Unsupported X network mode.")
    if network_mode == "vpn_direct":
        return await probe_direct_egress(ip_check_url)
    if not xuse_is_installed():
        return NetworkProbeResult(False, error_code="xuse_not_installed", error_message="x-use-mcp is not installed in the worker environment.")
    if account not in configured_account_keys(x_use_home):
        return NetworkProbeResult(False, error_code="account_not_configured", error_message=f"x-use account '{account}' is not active or has no local cookie file.")

    from mcp import ClientSession
    from mcp.client.stdio import stdio_client

    x_use_home.mkdir(parents=True, exist_ok=True)
    log_path = x_use_home / "logs" / "diy-reply-worker-stderr.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    parameters, _ = _server_parameters(x_use_home)
    try:
        with log_path.open("a", encoding="utf-8") as errors:
            async with stdio_client(parameters, errlog=errors) as (read, write):
                async with ClientSession(read, write) as session:
                    await asyncio.wait_for(session.initialize(), timeout=45)
                    return await _probe_fixed_proxy(session, x_use_home=x_use_home, account=account, proxy_url=proxy_url)
    except asyncio.TimeoutError:
        return NetworkProbeResult(False, error_code="network_probe_timeout", error_message="The fixed proxy check timed out; direct fallback is forbidden.")
    except Exception as error:
        return NetworkProbeResult(False, error_code="network_probe_failed", error_message=_redact_sensitive(f"{type(error).__name__}: {error}"))


async def verify_account_mapping(
    *,
    x_use_home: Path,
    account: str,
    network_mode: str,
    proxy_url: str | None,
    ip_check_url: str,
) -> AccountMappingVerificationResult:
    """Open the configured X session read-only and return its visible owner plus route IP."""
    if network_mode not in NETWORK_MODES:
        return AccountMappingVerificationResult(False, error_code="invalid_network_mode", error_message="Unsupported X network mode.")
    if not xuse_is_installed():
        return AccountMappingVerificationResult(False, error_code="xuse_not_installed", error_message="x-use-mcp is not installed in the worker environment.")
    if account not in configured_account_keys(x_use_home):
        return AccountMappingVerificationResult(False, error_code="account_not_configured", error_message=f"x-use account '{account}' is not active or has no local cookie file.")
    if network_mode == "fixed_proxy" and not proxy_url:
        return AccountMappingVerificationResult(False, error_code="proxy_required", error_message="The fixed_proxy account has no dedicated route.")

    from mcp import ClientSession
    from mcp.client.stdio import stdio_client

    x_use_home.mkdir(parents=True, exist_ok=True)
    log_path = x_use_home / "logs" / "diy-reply-worker-stderr.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    parameters, _ = _server_parameters(x_use_home)
    try:
        direct_probe = await probe_direct_egress(ip_check_url) if network_mode == "vpn_direct" else None
        if direct_probe and (not direct_probe.ok or not direct_probe.egress_ip):
            return AccountMappingVerificationResult(False, error_code=direct_probe.error_code, error_message=direct_probe.error_message)
        egress_ip = direct_probe.egress_ip if direct_probe else None
        with log_path.open("a", encoding="utf-8") as errors:
            async with stdio_client(parameters, errlog=errors) as (read, write):
                async with ClientSession(read, write) as session:
                    await asyncio.wait_for(session.initialize(), timeout=45)
                    if network_mode == "fixed_proxy":
                        proxy_probe = await _probe_fixed_proxy(session, x_use_home=x_use_home, account=account, proxy_url=proxy_url)
                        if not proxy_probe.ok or not proxy_probe.egress_ip:
                            return AccountMappingVerificationResult(False, error_code=proxy_probe.error_code, error_message=proxy_probe.error_message)
                        egress_ip = proxy_probe.egress_ip
                    identity_call = await asyncio.wait_for(
                        session.call_tool("get_account_analytics", {"account": account, "limit": 1}),
                        timeout=120,
                    )
                    identity = _payload(identity_call)
                    if not identity.get("ok"):
                        code, message, _ = _error_fields(identity)
                        return AccountMappingVerificationResult(False, egress_ip=egress_ip, error_code=code, error_message=message)
                    owner = identity.get("owner")
                    actual_handle = owner.get("handle") if isinstance(owner, dict) else None
                    if not isinstance(actual_handle, str) or not re.fullmatch(r"[A-Za-z0-9_]{1,15}", actual_handle):
                        return AccountMappingVerificationResult(False, egress_ip=egress_ip, error_code="owner_unconfirmed", error_message="The visible signed-in X owner could not be confirmed.")
                    return AccountMappingVerificationResult(True, actual_handle=actual_handle, egress_ip=egress_ip)
    except asyncio.TimeoutError:
        return AccountMappingVerificationResult(False, error_code="mapping_verification_timeout", error_message="The account mapping verification timed out.")
    except Exception as error:
        return AccountMappingVerificationResult(False, error_code="mapping_verification_failed", error_message=_redact_sensitive(f"{type(error).__name__}: {error}"))


async def send_approved_action(
    *,
    x_use_home: Path,
    account: str,
    action_type: str,
    tweet_url: str | None,
    text: str,
    media: list[str] | None = None,
    network_mode: str,
    ip_check_url: str,
    proxy_url: str | None = None,
    verify_route: Callable[[str], Awaitable[tuple[bool, str | None]]] | None = None,
) -> ReplyResult:
    if action_type not in {"post", "reply"}:
        return ReplyResult(status="failed", error_code="invalid_action_type", error_message="X action type must be 'post' or 'reply'.")
    if action_type == "reply" and not tweet_url:
        return ReplyResult(status="failed", error_code="missing_target_url", error_message="A reply requires a target X post URL.")
    if network_mode not in NETWORK_MODES:
        return ReplyResult(status="failed", error_code="invalid_network_mode", error_message="Unsupported X network mode.")
    if not xuse_is_installed():
        return ReplyResult(status="failed", error_code="xuse_not_installed", error_message="x-use-mcp is not installed in the worker environment.")
    if account not in configured_account_keys(x_use_home):
        return ReplyResult(status="failed", error_code="account_not_configured", error_message=f"x-use account '{account}' is not active or has no local cookie file.")
    if network_mode == "fixed_proxy" and not proxy_url:
        return ReplyResult(status="failed", error_code="proxy_required", error_message="The fixed_proxy account has no dedicated route; direct fallback is forbidden.")

    from mcp import ClientSession
    from mcp.client.stdio import stdio_client

    x_use_home.mkdir(parents=True, exist_ok=True)
    log_path = x_use_home / "logs" / "diy-reply-worker-stderr.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    parameters, _ = _server_parameters(x_use_home)
    draft_id: str | None = None
    egress_ip: str | None = None
    try:
        direct_probe = await probe_direct_egress(ip_check_url) if network_mode == "vpn_direct" else None
        if direct_probe and not direct_probe.ok:
            return ReplyResult(status="failed", error_code=direct_probe.error_code, error_message=direct_probe.error_message)
        if direct_probe:
            egress_ip = direct_probe.egress_ip

        with log_path.open("a", encoding="utf-8") as errors:
            async with stdio_client(parameters, errlog=errors) as (read, write):
                async with ClientSession(read, write) as session:
                    await asyncio.wait_for(session.initialize(), timeout=45)
                    if network_mode == "fixed_proxy":
                        proxy_probe = await _probe_fixed_proxy(session, x_use_home=x_use_home, account=account, proxy_url=proxy_url)
                        if not proxy_probe.ok:
                            return ReplyResult(status="failed", error_code=proxy_probe.error_code, error_message=proxy_probe.error_message)
                        egress_ip = proxy_probe.egress_ip

                    if not egress_ip:
                        return ReplyResult(status="failed", error_code="route_ip_unconfirmed", error_message="The browser route did not return a confirmed egress IP.")
                    if verify_route:
                        accepted, verification_error = await verify_route(egress_ip)
                        if not accepted:
                            return ReplyResult(status="failed", error_code="network_route_rejected", error_message=verification_error or "The browser route was rejected by the website.", egress_ip=egress_ip)

                    tool_name = "post_tweet" if action_type == "post" else "reply_to_tweet"
                    tool_arguments = {"account": account, "text": text}
                    if tweet_url:
                        tool_arguments["tweet_url"] = tweet_url
                    if media:
                        tool_arguments["media"] = media
                    draft_call = await asyncio.wait_for(session.call_tool(tool_name, tool_arguments), timeout=60)
                    draft = _payload(draft_call)
                    if not draft.get("ok"):
                        code, message, action_id = _error_fields(draft)
                        return ReplyResult(status="failed", action_id=action_id, error_code=code, error_message=message, egress_ip=egress_ip)
                    draft_id = str(draft.get("draft_id") or "") or None
                    if not draft_id or draft.get("status") != "pending":
                        return ReplyResult(status="failed", draft_id=draft_id, error_code="draft_gate_missing", error_message="x-use did not return a pending draft; nothing was sent.", egress_ip=egress_ip)

                    approval_call = await asyncio.wait_for(session.call_tool("approve_draft", {"draft_id": draft_id}), timeout=180)
                    approval = _payload(approval_call)
                    if not approval.get("ok"):
                        code, message, action_id = _error_fields(approval)
                        return ReplyResult(status=_approval_failure_status(code, action_id), draft_id=draft_id, action_id=action_id, error_code=code, error_message=message, egress_ip=egress_ip)
                    result = approval.get("result") if isinstance(approval.get("result"), dict) else approval
                    action_id = result.get("action_id") if isinstance(result, dict) else None
                    return ReplyResult(
                        status="sent",
                        draft_id=draft_id,
                        action_id=str(action_id)[:160] if action_id else None,
                        result_url=_first_x_url(result),
                        egress_ip=egress_ip,
                    )
    except asyncio.TimeoutError:
        return ReplyResult(status="uncertain" if draft_id else "failed", draft_id=draft_id, error_code="xuse_timeout", error_message="x-use timed out. If approval had started, inspect X before any new action.", egress_ip=egress_ip)
    except Exception as error:
        return ReplyResult(
            status="uncertain" if draft_id else "failed",
            draft_id=draft_id,
            error_code=type(error).__name__[:100],
            error_message=_redact_sensitive(f"{type(error).__name__}: {error}"),
            egress_ip=egress_ip,
        )


async def send_approved_reply(
    *,
    x_use_home: Path,
    account: str,
    tweet_url: str,
    text: str,
) -> ReplyResult:
    """Backward-compatible wrapper for older callers and tests."""
    return await send_approved_action(
        x_use_home=x_use_home,
        account=account,
        action_type="reply",
        tweet_url=tweet_url,
        text=text,
        network_mode="fixed_proxy",
        ip_check_url="https://api.ipify.org?format=json",
        proxy_url=None,
        verify_route=None,
    )
