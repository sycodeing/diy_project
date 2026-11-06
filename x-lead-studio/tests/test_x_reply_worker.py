from __future__ import annotations

import asyncio
from dataclasses import replace

import httpx

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

    async def execute_mapping(_settings, _client, value):
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
