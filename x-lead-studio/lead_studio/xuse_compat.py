"""Narrow compatibility for x-use 3.1.0 and X's shortened reply preview."""

from __future__ import annotations

import asyncio
import re
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlsplit


def _matches_truncated_preview(source: str, preview: str) -> bool:
    source = " ".join(source.split())
    preview = " ".join(preview.split())
    if len(source) < 500 or not 200 <= len(preview) < len(source):
        return False
    # X currently renders only the start of long posts in the reply dialog,
    # sometimes replacing a URL later in the preview. Require a substantial
    # exact prefix from the independently verified source post.
    return source[:200] == preview[:200]


def _matches_media_preview(source: str, preview: str, media_count: int) -> bool:
    if not 1 <= media_count <= 4:
        return False
    source = " ".join(source.split())
    preview = re.sub(r"(https?://)\s+", r"\1", preview)
    preview = " ".join(preview.split())
    if not source or not preview.startswith(source + " "):
        return False
    suffix = preview[len(source) + 1:].split()
    return 1 <= len(suffix) <= media_count and all(
        re.fullmatch(r"https://pic\.x\.com/[A-Za-z0-9]+", item) for item in suffix
    )


def _matches_published_text(source: str, observed: str) -> bool:
    def normalize(value: str) -> str:
        # X displays a link with line breaks and may hide the leading www.
        value = re.sub(r"(https?://)\s+", r"\1", value)
        value = " ".join(value.split())
        return re.sub(r"https?://www\.", "https://", value, flags=re.I)

    return bool(source and observed) and normalize(source) == normalize(observed)


def install_xuse_reply_preview_compatibility() -> None:
    import xuse
    from xuse.browser import page as xpage
    from xuse.browser.errors import BrowserActionError, BrowserBlocked

    if xuse.__version__ != "3.1.0":
        raise RuntimeError("Review the X reply preview compatibility before changing x-use versions.")
    original_verify = xpage.XBrowser._verify_reply_target
    original_observe = xpage.XBrowser._observe_submission
    original_target = xpage.XBrowser._target

    async def find_target(self, url, *, wait_for_target=False):
        try:
            return await original_target(self, url, wait_for_target=wait_for_target)
        except BrowserActionError as error:
            target = xpage.status_id(url)
            if (error.reason not in {"tweet_not_found", "unsupported_dom"}
                    or not target or xpage.status_id(self.page.url) != target):
                raise
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                await self.check_blocked()
                found = await self._find_target(target)
                if found and xpage.status_id(self.page.url) == target:
                    return found[0], found[1], target
                await asyncio.sleep(0.5)
            raise error

    def remember_target(self, original, target):
        if isinstance(original, dict) and xpage.status_id(original.get("status_url")) == target:
            self._diy_reply_target_url = urljoin("https://x.com", original["status_url"])

    async def verify_reply_target(self, composer, target, original=None, route=None):
        try:
            result = await original_verify(self, composer, target, original, route)
            remember_target(self, original, target)
            return result
        except BrowserActionError as error:
            if error.reason != "tweet_not_found" or route != "https://x.com/compose/post" or self.page.url != route:
                raise
            verified = xpage.tweet_from_snapshot(original)
            if (verified is None or verified.tweet_id != target or not verified.user_handle
                    or xpage.status_id(original.get("status_url")) != target):
                raise
            author = verified.user_handle.removeprefix("@").lower()
            cards = composer.locator(xpage._CARD + ":visible:not(" + xpage._QUOTED_DESCENDANTS + ")")
            if await cards.count() != 1 or not await cards.is_visible():
                raise
            card = cards.first
            preview = await card.evaluate(xpage._SNAPSHOT)
            if (not isinstance(preview, dict) or preview.get("status_url") is not None
                    or str(preview.get("handle") or "").removeprefix("@").lower() != author
                    or not (_matches_truncated_preview(verified.text_content, str(preview.get("text") or ""))
                            or _matches_media_preview(verified.text_content, str(preview.get("text") or ""), len(verified.media)))):
                raise
            user = card.get_by_test_id("User-Name")
            handles = user.get_by_text(re.compile(r"^@" + re.escape(author) + r"$", re.I), exact=True)
            avatar = card.locator('[data-testid^="UserAvatar-Container-"]:visible')
            if (await user.count() != 1 or await handles.count() != 1 or not await handles.is_visible()
                    or await avatar.count() != 1
                    or (await avatar.get_attribute("data-testid") or "").lower() != "useravatar-container-" + author):
                raise
            links = user.locator("a[href]")
            if await links.count() == 0:
                links = avatar.locator("a[href]")
            if not 1 <= await links.count() <= 8:
                raise
            for index in range(await links.count()):
                href = urljoin("https://x.com", await links.nth(index).get_attribute("href") or "")
                xpage.validate_x_url(href)
                parsed = urlsplit(href)
                if parsed.path.strip("/").lower() != author or parsed.query or parsed.fragment:
                    raise error
            remember_target(self, original, target)
            return None

    async def observe_submission(self, before, text, action, target=None):
        try:
            return await original_observe(self, before, text, action, target)
        except BrowserActionError as error:
            if error.reason != "outcome_unknown" or action != "reply" or not target:
                raise
            target_url = getattr(self, "_diy_reply_target_url", None)
            if xpage.status_id(target_url) != target:
                raise
            own = {str(value).removeprefix("@").lower() for value in (self.account.get("self_handles") or [])}
            if not own:
                raise
            submitted_after = datetime.now(timezone.utc) - timedelta(minutes=5)

            async def observed_reply():
                if self.page.url != target_url:
                    return None
                await self.check_blocked()
                for data in await self._snapshots():
                    tweet = xpage.tweet_from_snapshot(data)
                    if (tweet and tweet.tweet_id not in before
                            and str(tweet.user_handle).removeprefix("@").lower() in own
                            and tweet.created_at and submitted_after <= tweet.created_at <= datetime.now(timezone.utc) + timedelta(minutes=1)
                            and _matches_published_text(text, tweet.text_content)):
                        return self._result(action, tweet_id=tweet.tweet_id,
                                            tweet_url=str(tweet.tweet_url), reply_to=target,
                                            observed="new_own_permalink_and_normalized_text")
                return None

            try:
                # The composer can hide the newly published reply. Reload the
                # exact source conversation through the same bound browser.
                await self.navigate(target_url)
                await self.page.locator(xpage._CARD).first.wait_for(state="visible", timeout=20_000)
                for _ in range(40):
                    found = await observed_reply()
                    if found:
                        return found
                    await asyncio.sleep(0.5)
            except BrowserBlocked:
                raise
            except Exception:
                pass
            raise error

    xpage.XBrowser._verify_reply_target = verify_reply_target
    xpage.XBrowser._observe_submission = observe_submission
    xpage.XBrowser._target = find_target
