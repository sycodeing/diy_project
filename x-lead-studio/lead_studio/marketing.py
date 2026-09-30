from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from typing import Any

import httpx

from .config import Settings


def signed_headers(body: bytes, idempotency_key: str, secret: str, now: int | None = None, nonce: str | None = None) -> dict[str, str]:
    timestamp = str(now or int(time.time()))
    nonce = nonce or secrets.token_urlsafe(24)
    canonical = b"\n".join((timestamp.encode(), nonce.encode(), idempotency_key.encode(), body))
    signature = hmac.new(secret.encode(), canonical, hashlib.sha256).hexdigest()
    return {
        "Content-Type": "application/json",
        "x-marketing-timestamp": timestamp,
        "x-marketing-nonce": nonce,
        "x-marketing-idempotency-key": idempotency_key,
        "x-marketing-signature": signature,
    }


async def create_link(payload: dict[str, Any], idempotency_key: str, settings: Settings) -> dict[str, Any]:
    if len(settings.marketing_secret) < 32:
        raise RuntimeError("MARKETING_INGEST_SECRET must contain at least 32 characters.")
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            f"{settings.diy_site_url}/api/marketing/links",
            content=body,
            headers=signed_headers(body, idempotency_key, settings.marketing_secret),
        )
        response.raise_for_status()
        return response.json()
