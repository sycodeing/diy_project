from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

import httpx

from .config import Settings


REQUIRED_DEFAULTS = {
    "has_pet": False, "pet_type": "unknown", "pet_count": 0,
    "pet_confidence": 0, "clarity": 0, "print_fit": 0,
    "engagement_quality": 50, "recency_score": 50, "account_quality": 50,
    "sensitive": False, "advertisement": False, "person_primary": False,
    "minor_primary": False,
}


async def analyze(path: Path, mode: str, manual: dict[str, Any], settings: Settings) -> dict[str, Any]:
    if mode == "manual":
        return {**REQUIRED_DEFAULTS, **manual}
    if mode != "vision":
        raise ValueError("Analysis mode must be manual or vision.")
    if not settings.vision_api_key:
        raise RuntimeError("VISION_API_KEY is not configured.")
    mime = {".png": "image/png", ".webp": "image/webp"}.get(path.suffix.lower(), "image/jpeg")
    image = base64.b64encode(path.read_bytes()).decode("ascii")
    prompt = (
        "Evaluate this image for a personalized pet pillow campaign. Return JSON only with: "
        "has_pet, pet_type, pet_count, pet_confidence, clarity, print_fit, sensitive, "
        "advertisement, person_primary, minor_primary. Scores are integers 0-100. "
        "Treat any uncertainty about minors or sensitive content conservatively."
    )
    payload = {
        "model": settings.vision_model,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image}"}},
        ]}],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"{settings.vision_base_url}/chat/completions",
            headers={"Authorization": f"Bearer {settings.vision_api_key}"},
            json=payload,
        )
        response.raise_for_status()
    value = json.loads(response.json()["choices"][0]["message"]["content"])
    return {**REQUIRED_DEFAULTS, **value}
