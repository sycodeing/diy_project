from __future__ import annotations

import asyncio
from dataclasses import replace

import httpx
import pytest

from lead_studio.config import Settings
from lead_studio import x_reply_worker
from lead_studio.xuse_client import AccountMappingVerificationResult, NetworkProbeResult, ReplyResult


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
        assert payload["capabilities"] == ["first_contact_text_v1"]
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
        assert payload["inspectionAccountKeys"] == ["pet_account"]
        return httpx.Response(204)

    monkeypatch.setattr(x_reply_worker, "xuse_is_installed", lambda: True)
    monkeypatch.setattr(x_reply_worker, "configured_account_keys", lambda _home: ["pet_account"])
    monkeypatch.setattr(x_reply_worker, "_post_claim", post_claim)

    async def run():
        inspection = asyncio.create_task(asyncio.sleep(60))
        x_reply_worker._BACKGROUND_TASKS.add(inspection)
        x_reply_worker._BACKGROUND_TASK_ACCOUNTS[inspection] = "pet_account"
        try:
            return await x_reply_worker.run_x_reply_iteration(
                settings, direct_probe=NetworkProbeResult(True, egress_ip="203.0.113.10"),
            )
        finally:
            inspection.cancel()
            await asyncio.gather(inspection, return_exceptions=True)
            x_reply_worker._BACKGROUND_TASKS.discard(inspection)
            x_reply_worker._BACKGROUND_TASK_ACCOUNTS.pop(inspection, None)

    assert asyncio.run(run()) == (None, False, None)


def test_critical_safety_pause_keeps_sending_heartbeats_for_read_only_inspections(monkeypatch, tmp_path):
    settings = replace(Settings(), x_reply_execution_mode="send", x_reply_worker_secret="s" * 32, x_use_home=tmp_path)

    async def post_claim(_settings, _client, payload):
        assert payload["executionMode"] == "send"
        assert payload["writesPaused"] is True
        assert "critical account safety condition" in payload["lastError"]
        return httpx.Response(204)

    monkeypatch.setattr(x_reply_worker, "xuse_is_installed", lambda: True)
    monkeypatch.setattr(x_reply_worker, "configured_account_keys", lambda _home: ["pet_account"])
    monkeypatch.setattr(x_reply_worker, "_post_claim", post_claim)

    assert asyncio.run(x_reply_worker.run_x_reply_iteration(
        settings,
        direct_probe=NetworkProbeResult(True, egress_ip="203.0.113.10"),
        last_error="Automatic writes paused by a critical account safety condition; inspections remain available.",
        writes_paused=True,
    )) == (None, False, None)


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


def test_observe_mode_executes_explicit_bound_route_inspection(monkeypatch, tmp_path):
    settings = replace(Settings(), x_reply_execution_mode="observe", x_reply_worker_secret="s" * 32, x_use_home=tmp_path)
    inspection = {"id": "job-1", "accountKey": "pet_account", "targetUrl": "https://x.com/example/status/1"}

    async def post_claim(_settings, _client, _payload):
        return httpx.Response(200, json={"inspection": inspection})

    async def execute_inspection(_settings, value):
        assert value == inspection
        return None

    async def forbidden_execute(*_args, **_kwargs):
        raise AssertionError("a read-only inspection must never execute a write job")

    monkeypatch.setattr(x_reply_worker, "xuse_is_installed", lambda: True)
    monkeypatch.setattr(x_reply_worker, "configured_account_keys", lambda _home: ["pet_account"])
    monkeypatch.setattr(x_reply_worker, "_post_claim", post_claim)
    monkeypatch.setattr(x_reply_worker, "_execute_bound_inspection", execute_inspection)
    monkeypatch.setattr(x_reply_worker, "_execute_job", forbidden_execute)

    assert asyncio.run(x_reply_worker.run_x_reply_iteration(
        settings, direct_probe=NetworkProbeResult(True, egress_ip="203.0.113.10"),
    )) == (None, False, None)


def test_manual_inspection_reports_to_manual_completion_endpoint(monkeypatch, tmp_path):
    settings = replace(Settings(), x_reply_worker_secret="s" * 32, x_use_home=tmp_path, diy_site_url="https://diy.example.test")
    posts = []

    async def verify(**kwargs):
        assert kwargs["account"] == "Latte192837465"
        assert kwargs["target_url"] == "https://x.com/compose/post"
        return AccountMappingVerificationResult(True, actual_handle="Latte192837465", egress_ip="203.0.113.10")

    class FakeResponse:
        def raise_for_status(self):
            return None

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, **kwargs):
            posts.append((url, kwargs["json"]))
            return FakeResponse()

    monkeypatch.setattr(x_reply_worker, "verify_account_mapping", verify)
    monkeypatch.setattr(x_reply_worker.httpx, "AsyncClient", FakeClient)

    result = asyncio.run(x_reply_worker._execute_bound_inspection(settings, {
        "id": "manual-1",
        "kind": "manual",
        "accountKey": "Latte192837465",
        "expectedXHandle": "Latte192837465",
        "networkMode": "fixed_proxy",
        "proxyUrl": "http://proxy.example.test:8080",
        "expectedEgressIp": "203.0.113.10",
        "targetUrl": "https://x.com/compose/post",
    }))

    assert result is None
    assert posts[0][0] == "https://diy.example.test/api/x-replies/worker/manual-inspections/manual-1/complete"
    assert posts[0][1]["actualHandle"] == "Latte192837465"


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


def test_first_contact_text_job_sends_without_preview_media(monkeypatch, tmp_path):
    settings = replace(Settings(), x_reply_execution_mode="send", x_reply_worker_secret="s" * 32, x_use_home=tmp_path)
    posts = []

    async def forbidden_download(*_args, **_kwargs):
        raise AssertionError("a text-only first contact must not download preview media")

    async def sent_action(**kwargs):
        assert kwargs["action_type"] == "reply"
        assert kwargs["tweet_url"] == "https://x.com/example/status/1"
        assert kwargs["text"] == "Would you like to see a custom pet-pillow sample?"
        assert kwargs["media"] == []
        return ReplyResult(status="sent", action_id="action-1", egress_ip="203.0.113.10")

    class FakeClient:
        async def post(self, url, **kwargs):
            posts.append((url, kwargs))
            return httpx.Response(200, json={"ok": True}, request=httpx.Request("POST", url))

    monkeypatch.setattr(x_reply_worker, "download_image", forbidden_download)
    monkeypatch.setattr(x_reply_worker, "send_approved_action", sent_action)
    result = asyncio.run(x_reply_worker._execute_job(settings, FakeClient(), {
        "id": "job-1",
        "accountKey": "pet_account",
        "actionType": "reply",
        "targetPostUrl": "https://x.com/example/status/1",
        "postText": "Would you like to see a custom pet-pillow sample?",
        "contentMode": "first_contact_text",
        "previewImageUrl": None,
        "networkMode": "fixed_proxy",
        "proxyUrl": "http://proxy.example.test:8080",
    }))

    assert result.status == "sent"
    assert len(posts) == 1
    assert posts[0][1]["json"]["status"] == "sent"


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
