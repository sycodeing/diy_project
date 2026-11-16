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
            answer = {"real_pet_photo": seen.count("vision") == 2, "pet_type": "cat",
                      "preview_usable": True, "quality_score": 85}
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


@pytest.mark.parametrize("verdicts,chosen", [
    ([{"quality_score": 75}, {"quality_score": 95}], 1),
    ([{"quality_score": 95}, {"quality_score": 75}], 0),
    ([{"quality_score": 85}, {"quality_score": 85}], 0),
    ([{"preview_usable": False}, {"quality_score": 85}], 1),
    ([{"quality_score": 69}], None),
    ([{"quality_score": "95"}], None),
    ([{"quality_score": True}], None),
    ([{"quality_score": 101}], None),
    ([{"quality_score": None}], None),
    ([{"preview_usable": "true"}], None),
    ([{"pet_type": "dog"}], None),
    ([{"real_pet_photo": False}], None),
])
def test_best_preview_photo_checks_every_attachment_and_fails_closed(verdicts, chosen):
    calls = []
    urls = [f"https://img.example/{index}.jpg" for index in range(len(verdicts))]

    def handler(request):
        if request.url.path == "/api/chat":
            answer = {"real_pet_photo": True, "pet_type": "cat", "preview_usable": True,
                      "quality_score": 80, **verdicts[len(calls)]}
            calls.append(answer)
            return httpx.Response(200, json={"message": {"content": json.dumps(answer)}})
        return httpx.Response(200, content=_image())

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await verify_pet_photo({"pet_type": "cat", "media_urls": urls,
                                           "targeting_json": "{}"}, client, Settings())

    result = asyncio.run(run())
    assert len(calls) == len(verdicts)
    if chosen is None:
        assert result is None
    else:
        assert result["media_url"] == urls[chosen]
        evidence = json.loads(result["targeting_json"])["image_verification"]
        assert evidence["preview_usable"] is True
        assert len(evidence["assessments"]) == len(verdicts)


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


def test_demand_photo_can_resolve_a_pending_pet_type_but_generic_unknowns_still_fail():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/chat":
            return httpx.Response(200, json={"message": {"content": json.dumps({
                "real_pet_photo": True, "pet_type": "dog", "preview_usable": True,
                "quality_score": 86,
            })}})
        return httpx.Response(200, content=_image())

    async def run(candidate):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await verify_pet_photo(candidate, client, Settings())

    candidate = {"pet_type": None, "media_url": "https://img.example/dog.jpg",
                 "targeting_json": json.dumps({"discovery_mode": "purchase_intent",
                                               "pet_type_evidence_pending": True})}
    resolved = asyncio.run(run(candidate))
    assert resolved["pet_type"] == "dog"
    evidence = json.loads(resolved["targeting_json"])
    assert evidence["pet_type_evidence_pending"] is False
    assert evidence["image_verification"]["pet_type"] == "dog"
    assert asyncio.run(run({**candidate, "targeting_json": "{}"})) is None


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
