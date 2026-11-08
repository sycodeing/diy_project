from __future__ import annotations

import asyncio
import json
from io import BytesIO

import httpx
import pytest
from PIL import Image

from lead_studio.config import Settings
from lead_studio.pet_image_gate import ensure_pet_image_verifier, verify_pet_photo
from lead_studio.targeting import build_targeting


def _image() -> bytes:
    output = BytesIO()
    Image.new("RGB", (20, 20), "white").save(output, format="JPEG")
    return output.getvalue()


def test_post_pet_type_cannot_come_only_from_bio():
    targeting = build_targeting({
        "rawContent": "Here is my birthday selfie",
        "author": {"description": "Proud cat owner", "location": "Austin, TX"},
    }, "pet_birthday")
    assert targeting["pet_type"] is None


def test_image_gate_selects_matching_real_photo_and_records_evidence():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/chat":
            seen.append("vision")
            answer = {"real_pet_photo": seen.count("vision") == 2, "pet_type": "cat"}
            return httpx.Response(200, json={"message": {"content": json.dumps(answer)}})
        seen.append(str(request.url))
        return httpx.Response(200, content=_image(), headers={"content-type": "image/jpeg"})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await verify_pet_photo({
                "pet_type": "cat", "media_url": "https://img.example/a.jpg",
                "media_urls": ["https://img.example/a.jpg", "https://img.example/b.jpg"],
                "targeting_json": "{}",
            }, client, Settings())

    result = asyncio.run(run())
    assert result is not None
    assert result["media_url"] == "https://img.example/b.jpg"
    assert result["media_urls"] == ["https://img.example/b.jpg"]
    assert json.loads(result["targeting_json"])["image_verification"]["result"] == "verified"


def test_image_gate_rejects_wrong_species():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/chat":
            return httpx.Response(200, json={"message": {"content": json.dumps({
                "real_pet_photo": True, "pet_type": "dog",
            })}})
        return httpx.Response(200, content=_image())

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await verify_pet_photo({
                "pet_type": "cat", "media_url": "https://img.example/a.jpg",
                "targeting_json": "{}",
            }, client, Settings())

    assert asyncio.run(run()) is None


def test_image_gate_rejects_illustration_even_with_matching_species():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/chat":
            return httpx.Response(200, json={"message": {"content": json.dumps({
                "real_pet_photo": False, "pet_type": "cat",
            })}})
        return httpx.Response(200, content=_image())

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await verify_pet_photo({
                "pet_type": "cat", "media_url": "https://img.example/drawing.jpg",
                "targeting_json": "{}",
            }, client, Settings())

    assert asyncio.run(run()) is None


def test_missing_local_vision_model_blocks_before_collection():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/show"
        return httpx.Response(404, json={"error": "model not found"})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await ensure_pet_image_verifier(client, Settings())

    with pytest.raises(RuntimeError, match="not configured"):
        asyncio.run(run())
