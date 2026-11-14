import asyncio
from datetime import datetime, timezone

from lead_studio.xuse_compat import _matches_media_preview, _matches_published_text, _matches_truncated_preview, install_xuse_reply_preview_compatibility


def test_long_x_preview_requires_substantial_exact_prefix():
    source = "A" * 280 + "original URL" + "B" * 700
    preview = "A" * 280 + "display URL" + "B" * 100
    assert _matches_truncated_preview(source, preview)
    assert not _matches_truncated_preview(source, "A" * 199 + "changed" + "B" * 200)
    assert not _matches_truncated_preview(source, "A" * 100)
    assert not _matches_truncated_preview("A" * 400, "A" * 300)


def test_media_preview_accepts_only_source_text_and_bounded_picture_links():
    source = "my  dog turned 3 years old yesterday can everyone say Happy Birthday 😇"
    preview = source + " \n" + "\n".join(["https://\npic.x.com/tY8TgRQGVe"] * 4)
    assert _matches_media_preview(source, preview, 4)
    assert not _matches_media_preview(source, preview, 3)
    assert not _matches_media_preview(source + " extra", preview, 4)
    assert not _matches_media_preview(source, preview + " unrelated", 4)
    assert not _matches_media_preview(source, source + " https://other.example/photo", 4)


def test_compatibility_installs_on_pinned_xuse_version():
    from xuse.browser.page import XBrowser

    original = XBrowser._verify_reply_target
    original_observe = XBrowser._observe_submission
    original_target = XBrowser._target
    try:
        install_xuse_reply_preview_compatibility()
        assert XBrowser._verify_reply_target is not original
        assert XBrowser._observe_submission is not original_observe
        assert XBrowser._target is not original_target
    finally:
        XBrowser._verify_reply_target = original
        XBrowser._observe_submission = original_observe
        XBrowser._target = original_target


def test_published_text_normalizes_x_link_display_without_accepting_changed_copy():
    expected = "Pillow preview: https://www.thebestdiyshop.com/g/MI2QW2Mybjh1"
    observed = "Pillow preview: \nhttps://\nthebestdiyshop.com/g/MI2QW2Mybjh1"
    assert _matches_published_text(expected, observed)
    assert not _matches_published_text(expected, observed.replace("MI2QW2Mybjh1", "other"))
    assert not _matches_published_text(expected, observed.replace("Pillow", "Blanket"))


def test_unknown_reply_is_confirmed_only_by_new_matching_own_permalink(monkeypatch):
    from xuse.browser.errors import BrowserActionError
    from xuse.browser.page import XBrowser

    async def outcome_unknown(*_args, **_kwargs):
        raise BrowserActionError("outcome_unknown")

    original_verify = XBrowser._verify_reply_target
    original_observe = XBrowser._observe_submission
    original_target = XBrowser._target
    monkeypatch.setattr(XBrowser, "_observe_submission", outcome_unknown)
    try:
        install_xuse_reply_preview_compatibility()

        class VisibleCard:
            async def wait_for(self, **_kwargs):
                return None

        class Page:
            url = "https://x.com/compose/post"

            def locator(self, _selector):
                return type("Locator", (), {"first": VisibleCard()})()

        browser = XBrowser(Page(), {"self_handles": ["Latte192837465"]})
        browser._diy_reply_target_url = "https://x.com/NeonDaDragon/status/2120028387490033963"
        calls = 0

        async def snapshots():
            nonlocal calls
            calls += 1
            return [{"status_url": "/Latte192837465/status/2120442720124850590",
                     "handle": "@Latte192837465",
                     "created_at": datetime.now(timezone.utc).isoformat(),
                     "text": "Pillow preview: \nhttps://\nthebestdiyshop.com/g/MI2QW2Mybjh1"}]

        async def navigate(url):
            assert url == browser._diy_reply_target_url
            browser.page.url = url

        browser.check_blocked = lambda: asyncio.sleep(0)
        browser._snapshots = snapshots
        browser.navigate = navigate
        result = asyncio.run(browser._observe_submission(
            set(), "Pillow preview: https://www.thebestdiyshop.com/g/MI2QW2Mybjh1",
            "reply", "2120028387490033963"))
        assert result["success"] is True
        assert result["evidence"]["tweet_id"] == "2120442720124850590"
        assert calls == 1
    finally:
        XBrowser._verify_reply_target = original_verify
        XBrowser._observe_submission = original_observe
        XBrowser._target = original_target


def test_target_waits_for_exact_post_after_other_cards_load(monkeypatch):
    from xuse.browser.errors import BrowserActionError
    from xuse.browser.page import XBrowser

    async def early_missing(*_args, **_kwargs):
        raise BrowserActionError("tweet_not_found")

    original_verify = XBrowser._verify_reply_target
    original_observe = XBrowser._observe_submission
    original_target = XBrowser._target
    monkeypatch.setattr(XBrowser, "_target", early_missing)
    try:
        install_xuse_reply_preview_compatibility()

        class Page:
            url = "https://x.com/VUVULUVU/status/2120247109098287151"

        browser = XBrowser(Page())
        calls = 0

        async def find(_target):
            nonlocal calls
            calls += 1
            return None if calls == 1 else ("card", {"status_url": "/VUVULUVU/status/2120247109098287151"})

        browser.check_blocked = lambda: asyncio.sleep(0)
        browser._find_target = find
        result = asyncio.run(browser._target(Page.url))
        assert result[0] == "card"
        assert result[2] == "2120247109098287151"
        assert calls == 2
    finally:
        XBrowser._verify_reply_target = original_verify
        XBrowser._observe_submission = original_observe
        XBrowser._target = original_target
