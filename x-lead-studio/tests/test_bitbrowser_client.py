from __future__ import annotations

import asyncio

import httpx
import pytest

from lead_studio.bitbrowser_client import BitBrowserClient, BitBrowserError


def test_lists_windows_from_local_api():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/browser/list"
        return httpx.Response(200, json={"success": True, "data": {"list": [
            {"id": "window-1", "name": "X US 01", "seq": 8, "status": 0},
        ]}})

    client = BitBrowserClient()
    client._post = lambda path, payload: _fake_post(handler, path, payload)  # type: ignore[method-assign]
    rows = asyncio.run(client.list_windows())
    assert rows[0].id == "window-1"
    assert rows[0].seq == 8


async def _fake_post(handler, path, payload):
    request = httpx.Request("POST", f"http://localhost{path}", json=payload)
    response = await handler(request)
    body = response.json()
    return body["data"]


def test_rejects_unsupported_or_incomplete_proxy_before_api_call():
    client = BitBrowserClient()
    with pytest.raises(BitBrowserError):
        asyncio.run(client.apply_proxy("window-1", "ftp://proxy.example:21"))
    with pytest.raises(BitBrowserError):
        asyncio.run(client.apply_proxy("window-1", "http://proxy.example"))
