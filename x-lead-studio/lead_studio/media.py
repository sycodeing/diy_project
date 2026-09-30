from __future__ import annotations

import hashlib
from pathlib import Path
from urllib.parse import urlparse

import httpx


async def download_image(url: str, destination_dir: Path) -> tuple[Path, str]:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("Only HTTPS media URLs are accepted.")
    async with httpx.AsyncClient(follow_redirects=True, timeout=20) as client:
        response = await client.get(url)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").split(";", 1)[0]
        if content_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise ValueError("Remote media is not a supported image.")
        if len(response.content) > 10 * 1024 * 1024:
            raise ValueError("Remote media exceeds 10 MB.")
    digest = hashlib.sha256(response.content).hexdigest()
    suffix = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[content_type]
    path = destination_dir / f"{digest}{suffix}"
    path.write_bytes(response.content)
    return path, digest
