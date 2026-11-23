from __future__ import annotations

import asyncio
import hashlib
from dataclasses import replace
from pathlib import Path

import httpx
import pytest

from lead_studio.config import Settings
from lead_studio import x_reply_worker
from lead_studio.xuse_client import NetworkProbeResult, ReplyResult


def test_observe_mode_reports_heartbeat_but_never_executes(monkeypatch, tmp_path):
    settings = replace(
        Settings(),
        x_reply_execution_mode="observe",
        x_reply_worker_secret="s" * 32,
        x_use_home=tmp_path,
    )

    async def direct_probe(_url):
        return NetworkProbeResult(True, egress_ip="203.0.113.10")

    async def post_claim(_settings, _client, payload):
        assert payload["executionMode"] == "observe"
        assert payload["executorId"] == "macbook-x-01"
        assert payload["workerVersion"] == "4.12.0-account-product-preview"
        assert "account_product_link_v2" in payload["capabilities"]
        assert "account_product_preview_v2" in payload["capabilities"]
        return httpx.Response(204)

    async def forbidden_execute(*_args, **_kwargs):
        raise AssertionError("observe mode must not execute a job")

    monkeypatch.setattr(x_reply_worker, "probe_direct_egress", direct_probe)
    monkeypatch.setattr(x_reply_worker, "xuse_is_installed", lambda: True)
    monkeypatch.setattr(x_reply_worker, "configured_account_keys", lambda _home: ["pet_account"])
    monkeypatch.setattr(x_reply_worker, "_post_claim", post_claim)
    monkeypatch.setattr(x_reply_worker, "_execute_job", forbidden_execute)

    last_error, halt, completed_status = asyncio.run(x_reply_worker.run_x_reply_iteration(settings))
    assert last_error is None
    assert halt is False
    assert completed_status is None


def test_observe_heartbeat_reuses_cached_egress_probe(monkeypatch, tmp_path):
    settings = replace(
        Settings(),
        x_reply_execution_mode="observe",
        x_reply_worker_secret="s" * 32,
        x_use_home=tmp_path,
    )

    async def forbidden_probe(_url):
        raise AssertionError("a cached heartbeat must not open another browser")

    async def post_claim(_settings, _client, payload):
        assert payload["currentEgressIp"] == "203.0.113.10"
        assert payload["networkProbeStatus"] == "healthy"
        return httpx.Response(204)

    monkeypatch.setattr(x_reply_worker, "probe_direct_egress", forbidden_probe)
    monkeypatch.setattr(x_reply_worker, "xuse_is_installed", lambda: True)
    monkeypatch.setattr(x_reply_worker, "configured_account_keys", lambda _home: ["pet_account"])
    monkeypatch.setattr(x_reply_worker, "_post_claim", post_claim)

    last_error, halt, completed_status = asyncio.run(x_reply_worker.run_x_reply_iteration(
        settings,
        direct_probe=NetworkProbeResult(True, egress_ip="203.0.113.10"),
    ))
    assert last_error is None
    assert halt is False
    assert completed_status is None


def test_inspection_heartbeat_marks_xuse_home_busy(monkeypatch, tmp_path):
    settings = replace(Settings(), x_reply_execution_mode="send", x_reply_worker_secret="s" * 32, x_use_home=tmp_path)

    async def post_claim(_settings, _client, payload):
        assert payload["inspectionBusy"] is True
        return httpx.Response(204)

    monkeypatch.setattr(x_reply_worker, "xuse_is_installed", lambda: True)
    monkeypatch.setattr(x_reply_worker, "configured_account_keys", lambda _home: ["pet_account"])
    monkeypatch.setattr(x_reply_worker, "_post_claim", post_claim)

    async def run():
        inspection = asyncio.create_task(asyncio.sleep(60))
        x_reply_worker._BACKGROUND_TASKS.add(inspection)
        try:
            return await x_reply_worker.run_x_reply_iteration(
                settings, direct_probe=NetworkProbeResult(True, egress_ip="203.0.113.10"),
            )
        finally:
            inspection.cancel()
            await asyncio.gather(inspection, return_exceptions=True)
            x_reply_worker._BACKGROUND_TASKS.discard(inspection)

    assert asyncio.run(run()) == (None, False, None)


def test_observe_mode_refuses_even_a_nonempty_server_response(monkeypatch, tmp_path):
    settings = replace(Settings(), x_reply_execution_mode="observe", x_reply_worker_secret="s" * 32, x_use_home=tmp_path)

    async def direct_probe(_url):
        return NetworkProbeResult(True, egress_ip="203.0.113.10")

    async def post_claim(_settings, _client, _payload):
        return httpx.Response(200, json={"job": {"id": "unexpected"}})

    async def forbidden_execute(*_args, **_kwargs):
        raise AssertionError("observe mode must fail closed")

    monkeypatch.setattr(x_reply_worker, "probe_direct_egress", direct_probe)
    monkeypatch.setattr(x_reply_worker, "xuse_is_installed", lambda: True)
    monkeypatch.setattr(x_reply_worker, "configured_account_keys", lambda _home: ["pet_account"])
    monkeypatch.setattr(x_reply_worker, "_post_claim", post_claim)
    monkeypatch.setattr(x_reply_worker, "_execute_job", forbidden_execute)

    last_error, halt, completed_status = asyncio.run(x_reply_worker.run_x_reply_iteration(settings))
    assert "refused" in (last_error or "")
    assert halt is False
    assert completed_status is None


def test_observe_mode_executes_explicit_read_only_mapping_verification(monkeypatch, tmp_path):
    settings = replace(Settings(), x_reply_execution_mode="observe", x_reply_worker_secret="s" * 32, x_use_home=tmp_path)
    verification = {"id": "account-1", "accountKey": "pet_account", "networkMode": "vpn_direct", "proxyUrl": None}

    async def direct_probe(_url):
        return NetworkProbeResult(True, egress_ip="203.0.113.10")

    async def post_claim(_settings, _client, _payload):
        return httpx.Response(200, json={"verification": verification})

    async def execute_mapping(_settings, value):
        assert value == verification
        return None

    async def forbidden_execute(*_args, **_kwargs):
        raise AssertionError("observe mode must never execute a write job")

    monkeypatch.setattr(x_reply_worker, "probe_direct_egress", direct_probe)
    monkeypatch.setattr(x_reply_worker, "xuse_is_installed", lambda: True)
    monkeypatch.setattr(x_reply_worker, "configured_account_keys", lambda _home: ["pet_account"])
    monkeypatch.setattr(x_reply_worker, "_post_claim", post_claim)
    monkeypatch.setattr(x_reply_worker, "_execute_mapping_verification", execute_mapping)
    monkeypatch.setattr(x_reply_worker, "_execute_job", forbidden_execute)

    last_error, halt, completed_status = asyncio.run(x_reply_worker.run_x_reply_iteration(settings))
    assert last_error is None
    assert halt is False
    assert completed_status is None


def test_batch_delay_is_randomized_between_fifteen_and_thirty_seconds(monkeypatch):
    calls = []

    def uniform(low, high):
        calls.append((low, high))
        return 22.5

    monkeypatch.setattr(x_reply_worker.random, "uniform", uniform)

    assert x_reply_worker._batch_delay_seconds() == 22.5
    assert calls == [(15.0, 30.0)]


def test_invalid_execution_mode_fails_closed_to_observe(monkeypatch):
    monkeypatch.setenv("X_REPLY_EXECUTION_MODE", "invalid")
    assert Settings().x_reply_execution_mode == "observe"


def test_uncertain_result_is_reported_once_and_never_retried(monkeypatch, tmp_path):
    settings = replace(Settings(), x_reply_execution_mode="send", x_reply_worker_secret="s" * 32, x_use_home=tmp_path)
    posts = []

    async def fake_download(url, destination):
        assert url == "https://preview.example.test/generated.webp"
        path = destination / "preview.webp"
        path.write_bytes(b"preview")
        return path, "digest"

    async def uncertain_action(**kwargs):
        assert len(kwargs["media"]) == 1
        assert kwargs["media"][0].endswith("preview.webp")
        return ReplyResult(
            status="uncertain",
            draft_id="draft-1",
            action_id="action-1",
            error_code="send_unconfirmed",
            error_message="Inspect X before any new action.",
            egress_ip="203.0.113.10",
        )

    class FakeClient:
        async def post(self, url, **kwargs):
            posts.append((url, kwargs))
            return httpx.Response(200, json={"ok": True}, request=httpx.Request("POST", url))

    monkeypatch.setattr(x_reply_worker, "send_approved_action", uncertain_action)
    monkeypatch.setattr(x_reply_worker, "download_image", fake_download)
    result = asyncio.run(x_reply_worker._execute_job(settings, FakeClient(), {
        "id": "job-1",
        "accountKey": "pet_account",
        "actionType": "reply",
        "targetPostUrl": "https://x.com/example/status/1",
        "postText": "Exact approved text",
        "previewImageUrl": "https://preview.example.test/generated.webp",
        "networkMode": "vpn_direct",
        "proxyUrl": None,
    }))

    assert result.status == "uncertain"
    assert len(posts) == 1
    assert posts[0][0].endswith("/api/x-replies/worker/jobs/job-1/complete")
    assert posts[0][1]["json"]["status"] == "uncertain"


def test_login_challenge_and_rate_limit_halt_worker():
    assert x_reply_worker._must_halt("login_challenge", None) is True
    assert x_reply_worker._must_halt("rate_limit", "slow down") is True
    assert x_reply_worker._must_halt("proxy_failed", "route unavailable") is False


@pytest.mark.parametrize("patch,expected_sends", [
    ({}, 1),
    ({"previewImageUrl": "https://stale.example/image.jpg"}, 1),
    ({"contentMode": "legacy_preview"}, 0),
    ({"contentMode": "unknown"}, 0),
    ({"actionType": "post"}, 0),
    ({"postText": ""}, 0),
    ({"postText": "https://example.com"}, 0),
    ({"postText": "x" * 281}, 0),
])
def test_explicit_text_only_contract_without_media_download(monkeypatch, patch, expected_sends):
    sent = []
    completions = []

    async def forbidden_download(*args):
        raise AssertionError("Text-only first contact must never download media")

    async def fake_send(**kwargs):
        assert kwargs["media"] == []
        assert kwargs["text"] == "Would you like to see a sample?"
        sent.append(kwargs)
        return ReplyResult(status="sent", result_url="https://x.com/owner/status/2")

    class FakeClient:
        async def post(self, url, **kwargs):
            completions.append(kwargs["json"])
            return httpx.Response(200, json={"ok": True}, request=httpx.Request("POST", url))

    monkeypatch.setattr(x_reply_worker, "download_image", forbidden_download)
    monkeypatch.setattr(x_reply_worker, "send_approved_action", fake_send)
    result = asyncio.run(x_reply_worker._execute_job(Settings(), FakeClient(), {
        "id": "job-text", "accountKey": "pet_account", "actionType": "reply",
        "targetPostUrl": "https://x.com/owner/status/1", "postText": "Would you like to see a sample?",
        "contentMode": "first_contact_text", "networkMode": "vpn_direct", **patch,
    }))
    assert len(sent) == expected_sends
    assert len(completions) == 1
    assert result.status == ("sent" if expected_sends else "failed")


@pytest.mark.parametrize("mode,text,approved_link,expected_sends", [
    ("account_product_link", "A custom cover could suit your room. https://www.thebestdiyshop.com/g/abcdefghij", "https://www.thebestdiyshop.com/g/abcdefghij", 1),
    ("account_product_link", "A custom cover could suit your room. https://www.thebestdiyshop.com/g/abcdefghij", "https://www.thebestdiyshop.com/g/other12345", 0),
    ("account_product_link", "A custom cover could suit your room. https://www.thebestdiyshop.com/g/abcdefghij", "", 0),
    ("first_contact_text", "A custom cover could suit your room. https://www.thebestdiyshop.com/g/abcdefghij", "https://www.thebestdiyshop.com/g/abcdefghij", 0),
    ("legacy_preview", "A custom cover could suit your room.", "", 0),
])
def test_v2_product_link_is_text_only_and_bound_to_claim(monkeypatch, mode, text, approved_link, expected_sends):
    sent = []
    completions = []

    async def forbidden_download(*_args):
        raise AssertionError("V2 and rejected legacy jobs must not download media")

    async def fake_send(**kwargs):
        assert kwargs["media"] == []
        assert kwargs["text"] == text
        sent.append(kwargs)
        return ReplyResult(status="sent", result_url="https://x.com/owner/status/2")

    class FakeClient:
        async def post(self, url, **kwargs):
            completions.append(kwargs["json"])
            return httpx.Response(200, json={"ok": True}, request=httpx.Request("POST", url))

    monkeypatch.setattr(x_reply_worker, "download_image", forbidden_download)
    monkeypatch.setattr(x_reply_worker, "send_approved_action", fake_send)
    result = asyncio.run(x_reply_worker._execute_job(Settings(), FakeClient(), {
        "id": "job-v2", "accountKey": "pet_account", "actionType": "reply",
        "targetPostUrl": "https://x.com/owner/status/1", "postText": text,
        "contentMode": mode, "productLinkUrl": approved_link, "networkMode": "vpn_direct",
    }))
    assert len(sent) == expected_sends
    assert len(completions) == 1
    assert result.status == ("sent" if expected_sends else "failed")


@pytest.mark.parametrize("patch,expected_sends", [
    ({}, 1),
    ({"previewImageSha256": "0" * 64}, 0),
    ({"previewImageSha256": "INVALID"}, 0),
    ({"previewAssetId": ""}, 0),
    ({"previewAssetId": "other/preview.webp"}, 0),
    ({"previewImageUrl": "https://storage.example.test/storage/v1/object/sign/account-design-previews/other/preview.webp?token=signed"}, 0),
    ({"previewImageUrl": "http://storage.example.test/storage/v1/object/sign/account-design-previews/account/preview.webp?token=signed"}, 0),
    ({"previewImageUrl": "https://storage.example.test/storage/v1/object/sign/account-design-previews/account/preview.webp"}, 0),
    ({"productLinkUrl": "https://www.thebestdiyshop.com/g/other12345"}, 0),
    ({"postText": "https://www.thebestdiyshop.com/g/abcdefghij https://www.thebestdiyshop.com/g/abcdefghij"}, 0),
    ({"actionType": "post"}, 0),
    ({"targetPostUrl": None}, 0),
    ({"contentMode": "unknown"}, 0),
])
def test_account_product_preview_sends_only_exact_approved_media(monkeypatch, patch, expected_sends):
    preview_bytes = b"rendered original artwork through the approved template"
    preview_hash = hashlib.sha256(preview_bytes).hexdigest()
    asset_id = "account/preview.webp"
    preview_url = f"https://storage.example.test/storage/v1/object/sign/account-design-previews/{asset_id}?token=signed"
    text = "A custom cover could suit your room. https://www.thebestdiyshop.com/g/abcdefghij"
    downloaded = []
    sent = []
    completions = []

    async def fake_download(url, destination):
        assert url == preview_url
        downloaded.append(url)
        path = destination / "approved.webp"
        path.write_bytes(preview_bytes)
        return path, preview_hash

    async def fake_send(**kwargs):
        assert kwargs["text"] == text
        assert kwargs["action_type"] == "reply"
        assert len(kwargs["media"]) == 1
        assert hashlib.sha256(Path(kwargs["media"][0]).read_bytes()).hexdigest() == preview_hash
        sent.append(kwargs)
        return ReplyResult(status="sent", result_url="https://x.com/owner/status/2")

    class FakeClient:
        async def post(self, url, **kwargs):
            completions.append(kwargs["json"])
            return httpx.Response(200, json={"ok": True}, request=httpx.Request("POST", url))

    monkeypatch.setattr(x_reply_worker, "download_image", fake_download)
    monkeypatch.setattr(x_reply_worker, "send_approved_action", fake_send)
    job = {
        "id": "job-preview", "accountKey": "pet_account", "actionType": "reply",
        "targetPostUrl": "https://x.com/owner/status/1", "postText": text,
        "contentMode": "account_product_preview", "productLinkUrl": "https://www.thebestdiyshop.com/g/abcdefghij",
        "previewImageUrl": preview_url, "previewImageSha256": preview_hash, "previewAssetId": asset_id,
        "networkMode": "vpn_direct",
    }
    job.update(patch)
    result = asyncio.run(x_reply_worker._execute_job(Settings(), FakeClient(), job))
    assert len(sent) == expected_sends
    assert len(completions) == 1
    assert completions[0]["status"] == ("sent" if expected_sends else "failed")
    assert result.status == ("sent" if expected_sends else "failed")
    if expected_sends:
        assert downloaded == [preview_url]


def test_account_product_preview_download_failure_never_falls_back_to_text(monkeypatch):
    sent = []
    completions = []
    preview_url = "https://storage.example.test/storage/v1/object/sign/account-design-previews/account/preview.webp?token=signed"

    async def failed_download(*_args):
        raise httpx.HTTPError("expired signed URL")

    async def fake_send(**kwargs):
        sent.append(kwargs)
        raise AssertionError("No text-only fallback is allowed")

    class FakeClient:
        async def post(self, url, **kwargs):
            completions.append(kwargs["json"])
            return httpx.Response(200, json={"ok": True}, request=httpx.Request("POST", url))

    monkeypatch.setattr(x_reply_worker, "download_image", failed_download)
    monkeypatch.setattr(x_reply_worker, "send_approved_action", fake_send)
    result = asyncio.run(x_reply_worker._execute_job(Settings(), FakeClient(), {
        "id": "job-preview", "accountKey": "pet_account", "actionType": "reply",
        "targetPostUrl": "https://x.com/owner/status/1",
        "postText": "See the design. https://www.thebestdiyshop.com/g/abcdefghij",
        "contentMode": "account_product_preview",
        "productLinkUrl": "https://www.thebestdiyshop.com/g/abcdefghij",
        "previewImageUrl": preview_url,
        "previewImageSha256": "a" * 64,
        "previewAssetId": "account/preview.webp",
        "networkMode": "vpn_direct",
    }))
    assert result.status == "failed"
    assert sent == []
    assert [completion["status"] for completion in completions] == ["failed"]
