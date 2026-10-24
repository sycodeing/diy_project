import asyncio
import json
from datetime import datetime, timedelta, timezone

import httpx

from lead_studio.config import Settings
from lead_studio.preview_download_worker import _execute_download


def test_preview_download_creates_shanghai_day_folder(tmp_path):
    completions = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "image.test":
            return httpx.Response(200, headers={"content-type": "image/webp"}, content=b"preview-bytes")
        completions.append(json.loads(request.content))
        return httpx.Response(200, json={"ok": True})

    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            settings = Settings(diy_site_url="https://site.test", preview_download_root=tmp_path)
            await _execute_download(
                client,
                {"Authorization": "Bearer test"},
                settings,
                "test-worker",
                {"id": "job-1", "imageUrl": "https://image.test/preview"},
            )
            await _execute_download(
                client,
                {"Authorization": "Bearer test"},
                settings,
                "test-worker",
                {"id": "job-2", "imageUrl": "https://image.test/preview"},
            )

    asyncio.run(run())
    day = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")
    first = tmp_path / day / "001.webp"
    second = tmp_path / day / "002.webp"
    assert first.read_bytes() == b"preview-bytes"
    assert second.read_bytes() == b"preview-bytes"
    assert completions == [{
        "workerId": "test-worker",
        "status": "completed",
        "localPath": str(first),
        "errorMessage": None,
    }, {
        "workerId": "test-worker",
        "status": "completed",
        "localPath": str(second),
        "errorMessage": None,
    }]


def test_preview_redownload_reuses_existing_number(tmp_path):
    completion = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "image.test":
            return httpx.Response(200, headers={"content-type": "image/webp"}, content=b"updated-preview")
        completion.update(json.loads(request.content))
        return httpx.Response(200, json={"ok": True})

    day = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")
    destination = tmp_path / day
    destination.mkdir(parents=True)
    existing = destination / "007.webp"
    existing.write_bytes(b"old-preview")

    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await _execute_download(
                client,
                {"Authorization": "Bearer test"},
                Settings(diy_site_url="https://site.test", preview_download_root=tmp_path),
                "test-worker",
                {
                    "id": "job-7",
                    "imageUrl": "https://image.test/preview",
                    "existingLocalPath": str(existing),
                },
            )

    asyncio.run(run())
    assert existing.read_bytes() == b"updated-preview"
    assert not (destination / "008.webp").exists()
    assert completion["localPath"] == str(existing)
