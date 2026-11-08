from __future__ import annotations

import base64
import json
from io import BytesIO
from typing import Any

import httpx
from PIL import Image, UnidentifiedImageError

from .config import Settings


PROMPT = (
    "Inspect this image itself for a pet photo. Reply as JSON with exactly "
    "real_pet_photo (boolean) and pet_type (cat, dog, or none). True only if a "
    "clearly visible living cat or dog is a main subject in an original photograph. "
    "False for humans posing as pets, drawings, cartoons, game images, toys, "
    "screenshots, collages, product ads, text-only images, or an animal too tiny "
    "or obscured to identify. If uncertain, return false."
)


async def ensure_pet_image_verifier(client: httpx.AsyncClient, settings: Settings) -> None:
    if settings.pet_image_verifier == "openai":
        if settings.vision_api_key:
            return
        raise RuntimeError("Pet image verification is not configured")
    if settings.pet_image_verifier != "ollama":
        raise RuntimeError("Pet image verification is not configured")
    try:
        response = await client.post(
            f"{settings.ollama_url}/api/show",
            json={"model": settings.ollama_vision_model},
            timeout=15,
        )
        response.raise_for_status()
    except (httpx.HTTPError, ValueError) as error:
        raise RuntimeError("Pet image verification is not configured") from error
    capabilities = response.json().get("capabilities") or []
    if "vision" not in capabilities:
        raise RuntimeError("Pet image verification is not configured")


async def verify_pet_photo(
    candidate: dict[str, Any], client: httpx.AsyncClient, settings: Settings,
) -> dict[str, Any] | None:
    """Return candidate with a verified matching photo, or None. Errors fail the job closed."""
    expected = candidate.get("pet_type")
    if expected not in {"cat", "dog"}:
        return None
    urls = candidate.get("media_urls") or [candidate.get("media_url")]
    for url in urls[:4]:
        if not isinstance(url, str) or not url.startswith("https://"):
            continue
        response = await client.get(url, timeout=25)
        if response.status_code in {404, 410}:
            continue
        response.raise_for_status()
        if len(response.content) > 10 * 1024 * 1024:
            continue
        try:
            with Image.open(BytesIO(response.content)) as source:
                image = source.convert("RGB")
                image.thumbnail((768, 768))
                output = BytesIO()
                image.save(output, format="JPEG", quality=80)
        except (UnidentifiedImageError, OSError):
            continue
        encoded = base64.b64encode(output.getvalue()).decode("ascii")
        if settings.pet_image_verifier == "ollama":
            result = await client.post(
                f"{settings.ollama_url}/api/chat",
                json={
                    "model": settings.ollama_vision_model,
                    "stream": False,
                    "think": False,
                    "format": "json",
                    "messages": [{"role": "user", "content": PROMPT, "images": [encoded]}],
                },
                timeout=180,
            )
            result.raise_for_status()
            content = result.json()["message"]["content"]
        elif settings.pet_image_verifier == "openai":
            if not settings.vision_api_key:
                raise RuntimeError("Pet image verification is not configured")
            result = await client.post(
                f"{settings.vision_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {settings.vision_api_key}"},
                json={
                    "model": settings.vision_model,
                    "response_format": {"type": "json_object"},
                    "messages": [{"role": "user", "content": [
                        {"type": "text", "text": PROMPT},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}"}},
                    ]}],
                },
                timeout=120,
            )
            result.raise_for_status()
            content = result.json()["choices"][0]["message"]["content"]
        else:
            raise RuntimeError("Pet image verification is not configured")
        verdict = json.loads(content)
        if verdict.get("real_pet_photo") is True and verdict.get("pet_type") == expected:
            # Keep only the validated photo; other attachments may be screenshots
            # or unrelated images even when this post contains one real pet photo.
            verified = {**candidate, "media_url": url, "media_urls": [url]}
            target = json.loads(verified.get("targeting_json") or "{}")
            target["image_verification"] = {
                "result": "verified",
                "pet_type": expected,
                "media_url": url,
                "verifier": settings.pet_image_verifier,
                "model": settings.ollama_vision_model if settings.pet_image_verifier == "ollama" else settings.vision_model,
            }
            verified["targeting_json"] = json.dumps(target, ensure_ascii=False)
            return verified
    return None
