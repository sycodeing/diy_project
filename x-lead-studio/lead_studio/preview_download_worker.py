from __future__ import annotations

import asyncio
import re
import socket
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from .config import Settings


_EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
_NUMBERED_PREVIEW = re.compile(r"^(\d+)\.(?:jpe?g|png|webp)$", re.IGNORECASE)


async def run_preview_download_worker(settings: Settings) -> None:
    if len(settings.x_lead_worker_secret) < 32:
        return
    worker_id = f"{socket.gethostname()}-preview-download"[:120]
    headers = {"Authorization": f"Bearer {settings.x_lead_worker_secret}"}
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        while True:
            try:
                response = await client.post(
                    f"{settings.diy_site_url}/api/x-leads/worker/preview-downloads/claim",
                    headers=headers,
                    json={"workerId": worker_id},
                )
                if response.status_code == 204:
                    await asyncio.sleep(settings.preview_download_poll_seconds)
                    continue
                response.raise_for_status()
                job = response.json().get("job")
                if job:
                    await _execute_download(client, headers, settings, worker_id, job)
            except asyncio.CancelledError:
                raise
            except Exception:
                await asyncio.sleep(max(30, settings.preview_download_poll_seconds))


async def _execute_download(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    settings: Settings,
    worker_id: str,
    job: dict[str, Any],
) -> None:
    local_path: Path | None = None
    created_new_path = False
    error_message: str | None = None
    try:
        image = await client.get(str(job["imageUrl"]))
        image.raise_for_status()
        content_type = image.headers.get("content-type", "").split(";", 1)[0].lower()
        extension = _EXTENSIONS.get(content_type)
        if not extension:
            raise ValueError("预览文件不是支持的 JPG、PNG 或 WebP 图片。")
        if len(image.content) > 25 * 1024 * 1024:
            raise ValueError("预览图片超过 25MB，已停止保存。")

        day = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")
        destination = settings.preview_download_root / day
        destination.mkdir(parents=True, exist_ok=True)
        local_path = _existing_download_path(
            settings.preview_download_root,
            job.get("existingLocalPath"),
            extension,
        )
        if local_path is None:
            local_path = _next_numbered_path(destination, extension)
            created_new_path = True
        temporary = destination / f".{local_path.name}.{job['id']}.part"
        temporary.write_bytes(image.content)
        temporary.replace(local_path)
    except Exception as error:
        error_message = str(error)[:900] or type(error).__name__

    result = await client.post(
        f"{settings.diy_site_url}/api/x-leads/worker/preview-downloads/{job['id']}/complete",
        headers=headers,
        json={
            "workerId": worker_id,
            "status": "completed" if local_path else "failed",
            "localPath": str(local_path) if local_path else None,
            "errorMessage": error_message,
        },
    )
    if result.status_code == 409 and created_new_path and local_path:
        local_path.unlink(missing_ok=True)
    result.raise_for_status()


def _existing_download_path(
    root: Path,
    raw_path: Any,
    extension: str,
) -> Path | None:
    if not isinstance(raw_path, str) or not raw_path.strip():
        return None
    root = root.resolve()
    candidate = Path(raw_path).resolve()
    if not candidate.is_relative_to(root) or candidate.suffix.casefold() != extension:
        return None
    return candidate


def _next_numbered_path(destination: Path, extension: str) -> Path:
    highest = 0
    for path in destination.iterdir():
        if not path.is_file():
            continue
        match = _NUMBERED_PREVIEW.fullmatch(path.name)
        if match:
            highest = max(highest, int(match.group(1)))
    return destination / f"{highest + 1:03d}{extension}"
