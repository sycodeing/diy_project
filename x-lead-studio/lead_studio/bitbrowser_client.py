from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import unquote, urlparse

import httpx
from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


COMPOSER = "[data-testid='tweetTextarea_0'][role='textbox']"
SUBMIT = "button[data-testid='tweetButton']"
TOAST = "[data-testid='toast']"
ERROR_WORDS = ("try again", "rate limit", "over the limit", "went wrong", "already said that", "请重试", "频率限制")
SUCCESS_WORDS = ("your post was sent", "your reply was sent", "your tweet was sent", "你的帖子已发送", "你的回复已发送")
BLOCKED_PATHS = ("/i/flow/login", "/login", "/logout", "/account/access", "/i/flow/verify", "/challenge")
BLOCKED_SELECTORS = (
    "iframe[src*='captcha']", "iframe[src*='arkoselabs']", "[data-testid='ocfEnterTextTextInput']", "[data-testid='loginButton']",
)


@dataclass(frozen=True)
class BitBrowserWindow:
    id: str
    name: str
    seq: int | None
    status: int | None


@dataclass(frozen=True)
class PublishResult:
    status: str
    egress_ip: str | None = None
    result_url: str | None = None
    error_code: str | None = None
    error_message: str | None = None


class BitBrowserError(RuntimeError):
    pass


class BitBrowserClient:
    def __init__(self, base_url: str = "http://127.0.0.1:54345") -> None:
        self.base_url = base_url.rstrip("/")

    async def _post(self, path: str, payload: dict[str, Any]) -> Any:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(f"{self.base_url}{path}", json=payload)
        response.raise_for_status()
        body = response.json()
        if not body.get("success"):
            raise BitBrowserError(str(body.get("msg") or f"BitBrowser {path} failed"))
        return body.get("data")

    async def health(self) -> bool:
        try:
            await self._post("/health", {})
            return True
        except Exception:
            return False

    async def list_windows(self) -> list[BitBrowserWindow]:
        data = await self._post("/browser/list", {"page": 0, "pageSize": 100})
        rows = data.get("list", []) if isinstance(data, dict) else []
        return [BitBrowserWindow(
            id=str(row.get("id") or ""),
            name=str(row.get("name") or ""),
            seq=row.get("seq") if isinstance(row.get("seq"), int) else None,
            status=row.get("status") if isinstance(row.get("status"), int) else None,
        ) for row in rows if isinstance(row, dict) and row.get("id")]

    async def apply_proxy(self, window_id: str, proxy_url: str) -> None:
        parsed = urlparse(proxy_url)
        proxy_type = parsed.scheme.lower()
        if proxy_type not in {"http", "https", "socks5"} or not parsed.hostname or not parsed.port:
            raise BitBrowserError("Proxy URL must use http, https, or socks5 and include host:port.")
        await self._post("/browser/proxy/update", {
            "ids": [window_id],
            "proxyMethod": 2,
            "proxyType": proxy_type,
            "host": parsed.hostname,
            "port": parsed.port,
            "proxyUserName": unquote(parsed.username or ""),
            "proxyPassword": unquote(parsed.password or ""),
            "isGlobalProxyInfo": False,
        })

    async def open_window(self, window_id: str) -> dict[str, Any]:
        data = await self._post("/browser/open", {"id": window_id, "loadExtensions": True, "extractIp": True})
        if not isinstance(data, dict) or not data.get("http") or not data.get("driver"):
            raise BitBrowserError("BitBrowser did not return a debugger address and ChromeDriver path.")
        return data


def _visible(driver: webdriver.Chrome, css: str) -> list[Any]:
    return [element for element in driver.find_elements(By.CSS_SELECTOR, css) if element.is_displayed()]


def _assert_not_blocked(driver: webdriver.Chrome) -> None:
    path = urlparse(driver.current_url).path.lower()
    if path.startswith(BLOCKED_PATHS):
        raise BitBrowserError(f"X requires operator action at {path}.")
    if any(_visible(driver, selector) for selector in BLOCKED_SELECTORS):
        raise BitBrowserError("X login, verification, or CAPTCHA requires operator action.")
    text = (driver.find_element(By.TAG_NAME, "body").text or "").casefold()
    if any(value in text for value in ("your account is locked", "account suspended", "rate limit exceeded", "verify you are human")):
        raise BitBrowserError("X account challenge, lock, or rate limit detected.")


def _browser_ip(driver: webdriver.Chrome) -> str:
    original = driver.current_window_handle
    driver.switch_to.new_window("tab")
    try:
        driver.get("https://api.ipify.org?format=json")
        raw = WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.TAG_NAME, "body"))).text
        value = json.loads(raw).get("ip")
        if not isinstance(value, str) or not value:
            raise BitBrowserError("Browser proxy did not return an egress IP.")
        return value
    finally:
        driver.close()
        driver.switch_to.window(original)


def _fresh_success(driver: webdriver.Chrome, old_toasts: set[str]) -> tuple[bool, str | None]:
    for toast in _visible(driver, TOAST):
        text = " ".join((toast.text or "").casefold().split())
        if text in old_toasts:
            continue
        if any(word in text for word in ERROR_WORDS):
            raise BitBrowserError(f"X rejected the submission: {text[:240]}")
        if any(word in text for word in SUCCESS_WORDS):
            links = toast.find_elements(By.CSS_SELECTOR, "a[href*='/status/']")
            return True, links[0].get_attribute("href") if links else None
    return False, None


def publish_in_attached_window(
    open_data: dict[str, Any],
    action_type: str,
    target_url: str | None,
    text: str,
    verify_egress: Callable[[str], tuple[bool, str | None]],
) -> PublishResult:
    submitted = False
    egress_ip: str | None = None
    driver: webdriver.Chrome | None = None
    try:
        options = webdriver.ChromeOptions()
        options.add_experimental_option("debuggerAddress", str(open_data["http"]))
        driver = webdriver.Chrome(service=Service(str(open_data["driver"])), options=options)
        egress_ip = _browser_ip(driver)
        accepted, verification_error = verify_egress(egress_ip)
        if not accepted:
            return PublishResult("failed", egress_ip, error_code="proxy_route_rejected", error_message=verification_error or "The browser proxy route was rejected.")
        destination = "https://x.com/compose/post" if action_type == "post" else str(target_url or "")
        if action_type not in {"post", "reply"} or (action_type == "reply" and not destination):
            return PublishResult("failed", egress_ip, error_code="invalid_job", error_message="Invalid post/reply job.")
        driver.get(destination)
        WebDriverWait(driver, 25).until(lambda current: current.execute_script("return document.readyState") == "complete")
        _assert_not_blocked(driver)

        if action_type == "reply":
            status_id = urlparse(destination).path.rstrip("/").split("/")[-1]
            article_xpath = f"//article[.//a[contains(@href, '/status/{status_id}')]]"
            article = WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.XPATH, article_xpath)))
            reply_buttons = [button for button in article.find_elements(By.CSS_SELECTOR, "button[data-testid='reply']") if button.is_displayed()]
            if len(reply_buttons) != 1:
                raise BitBrowserError(f"Expected one reply button, found {len(reply_buttons)}.")
            reply_buttons[0].click()

        WebDriverWait(driver, 20).until(lambda current: len(_visible(current, COMPOSER)) == 1)
        composers = _visible(driver, COMPOSER)
        if len(composers) != 1:
            raise BitBrowserError(f"Expected one active composer, found {len(composers)}.")
        composer = composers[0]
        composer.click()
        composer.send_keys(Keys.CONTROL, "a")
        composer.send_keys(Keys.BACKSPACE)
        composer.send_keys(text[:270])
        WebDriverWait(driver, 15).until(lambda current: len(_visible(current, SUBMIT)) == 1)
        buttons = _visible(driver, SUBMIT)
        if len(buttons) != 1 or buttons[0].get_attribute("disabled") is not None or buttons[0].get_attribute("aria-disabled") == "true":
            raise BitBrowserError("X submit button is missing, ambiguous, or disabled.")
        old_toasts = {" ".join((toast.text or "").casefold().split()) for toast in _visible(driver, TOAST)}
        buttons[0].click()
        submitted = True
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            success, result_url = _fresh_success(driver, old_toasts)
            if success:
                return PublishResult("sent", egress_ip, result_url=result_url)
            time.sleep(0.25)
        return PublishResult("uncertain", egress_ip, error_code="send_unconfirmed", error_message="Clicked X submit once but no explicit success or error toast appeared. Inspect X before any retry.")
    except TimeoutException:
        return PublishResult("uncertain" if submitted else "failed", egress_ip, error_code="x_ui_timeout", error_message="X UI timed out; inspect the visible BitBrowser window.")
    except Exception as error:
        return PublishResult("uncertain" if submitted else "failed", egress_ip, error_code=type(error).__name__[:100], error_message=str(error)[:1000])
