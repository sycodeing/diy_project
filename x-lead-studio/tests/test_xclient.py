import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import pytest

from lead_studio import xclient


def test_mocked_read_only_search(monkeypatch):
    class FakeApi:
        async def search(self, q, limit, kv):
            assert q == "pets"
            assert kv == {"product": "Media"}
            for item in [{"id": 1}, {"id": 2}][:limit]:
                yield item

    @asynccontextmanager
    async def fake_client(_):
        yield FakeApi()

    monkeypatch.setattr(xclient, "client", fake_client)
    items = asyncio.run(xclient.read("search", {"q": "pets", "kv": {"product": "Media"}}, 2, Path("unused")))
    assert items == [{"id": 1}, {"id": 2}]


def test_write_operation_is_blocked_before_client_access():
    with pytest.raises(ValueError, match="read-only"):
        asyncio.run(xclient.read("send_dm", {}, 1, Path("unused")))
