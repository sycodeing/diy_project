from __future__ import annotations

import asyncio
from urllib.parse import urlsplit

from lead_studio.proxy_bridge import browser_compatible_proxy


async def _read_socks_target(reader: asyncio.StreamReader, atyp: int) -> str:
    if atyp == 1:
        return ".".join(str(value) for value in await reader.readexactly(4))
    if atyp == 3:
        length = (await reader.readexactly(1))[0]
        return (await reader.readexactly(length)).decode()
    raise AssertionError(f"unexpected address type {atyp}")


def test_authenticated_socks5_is_exposed_as_loopback_http_connect_proxy():
    async def run():
        observed: dict[str, object] = {}

        async def fake_socks(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
            assert await reader.readexactly(3) == b"\x05\x01\x02"
            writer.write(b"\x05\x02")
            await writer.drain()

            assert await reader.readexactly(1) == b"\x01"
            username_length = (await reader.readexactly(1))[0]
            observed["username"] = (await reader.readexactly(username_length)).decode()
            password_length = (await reader.readexactly(1))[0]
            observed["password"] = (await reader.readexactly(password_length)).decode()
            writer.write(b"\x01\x00")
            await writer.drain()

            version, command, reserved, atyp = await reader.readexactly(4)
            assert (version, command, reserved) == (5, 1, 0)
            observed["host"] = await _read_socks_target(reader, atyp)
            observed["port"] = int.from_bytes(await reader.readexactly(2), "big")
            writer.write(b"\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00")
            await writer.drain()
            assert await reader.readexactly(4) == b"ping"
            writer.write(b"pong")
            await writer.drain()
            writer.close()
            await writer.wait_closed()

        upstream = await asyncio.start_server(fake_socks, "127.0.0.1", 0)
        upstream_port = upstream.sockets[0].getsockname()[1]
        try:
            async with browser_compatible_proxy(
                f"socks5://alice:s3cret@127.0.0.1:{upstream_port}"
            ) as proxy_url:
                parsed = urlsplit(proxy_url)
                assert parsed.scheme == "http"
                assert parsed.hostname == "127.0.0.1"
                reader, writer = await asyncio.open_connection(parsed.hostname, parsed.port)
                writer.write(b"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n")
                await writer.drain()
                assert await reader.readuntil(b"\r\n\r\n") == b"HTTP/1.1 200 Connection Established\r\n\r\n"
                writer.write(b"ping")
                await writer.drain()
                assert await reader.readexactly(4) == b"pong"
                writer.close()
                await writer.wait_closed()
        finally:
            upstream.close()
            await upstream.wait_closed()

        assert observed == {
            "username": "alice",
            "password": "s3cret",
            "host": "example.com",
            "port": 443,
        }

    asyncio.run(run())


def test_http_proxy_is_returned_unchanged():
    async def run():
        value = "http://alice:secret@proxy.example:9000"
        async with browser_compatible_proxy(value) as proxy_url:
            assert proxy_url == value

    asyncio.run(run())


def test_authenticated_socks5_bridge_forwards_plain_http_absolute_requests():
    async def run():
        observed: dict[str, object] = {}

        async def fake_socks(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
            assert await reader.readexactly(3) == b"\x05\x01\x02"
            writer.write(b"\x05\x02")
            await writer.drain()
            assert await reader.readexactly(1) == b"\x01"
            username_length = (await reader.readexactly(1))[0]
            await reader.readexactly(username_length)
            password_length = (await reader.readexactly(1))[0]
            await reader.readexactly(password_length)
            writer.write(b"\x01\x00")
            await writer.drain()
            _version, _command, _reserved, atyp = await reader.readexactly(4)
            observed["host"] = await _read_socks_target(reader, atyp)
            observed["port"] = int.from_bytes(await reader.readexactly(2), "big")
            writer.write(b"\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00")
            await writer.drain()
            observed["request"] = await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK")
            await writer.drain()
            writer.close()
            await writer.wait_closed()

        upstream = await asyncio.start_server(fake_socks, "127.0.0.1", 0)
        upstream_port = upstream.sockets[0].getsockname()[1]
        try:
            async with browser_compatible_proxy(
                f"socks5://alice:s3cret@127.0.0.1:{upstream_port}"
            ) as proxy_url:
                parsed = urlsplit(proxy_url)
                reader, writer = await asyncio.open_connection(parsed.hostname, parsed.port)
                writer.write(
                    b"GET http://check.example/ip?format=text HTTP/1.1\r\n"
                    b"Host: check.example\r\n"
                    b"Proxy-Connection: keep-alive\r\n\r\n"
                )
                await writer.drain()
                response = await reader.read()
                assert response.endswith(b"OK")
                writer.close()
                await writer.wait_closed()
        finally:
            upstream.close()
            await upstream.wait_closed()

        assert observed["host"] == "check.example"
        assert observed["port"] == 80
        assert observed["request"] == (
            b"GET /ip?format=text HTTP/1.1\r\n"
            b"Host: check.example\r\n"
            b"Connection: close\r\n\r\n"
        )

    asyncio.run(run())


def test_authenticated_socks5_can_chain_through_local_transport(monkeypatch):
    async def run():
        observed: dict[str, object] = {}

        async def fake_transport(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
            assert await reader.readexactly(3) == b"\x05\x01\x00"
            writer.write(b"\x05\x00")
            await writer.drain()
            _version, _command, _reserved, atyp = await reader.readexactly(4)
            observed["upstream_host"] = await _read_socks_target(reader, atyp)
            observed["upstream_port"] = int.from_bytes(await reader.readexactly(2), "big")
            writer.write(b"\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00")
            await writer.drain()

            assert await reader.readexactly(3) == b"\x05\x01\x02"
            writer.write(b"\x05\x02")
            await writer.drain()
            assert await reader.readexactly(1) == b"\x01"
            username_length = (await reader.readexactly(1))[0]
            observed["username"] = (await reader.readexactly(username_length)).decode()
            password_length = (await reader.readexactly(1))[0]
            observed["password"] = (await reader.readexactly(password_length)).decode()
            writer.write(b"\x01\x00")
            await writer.drain()
            _version, _command, _reserved, atyp = await reader.readexactly(4)
            observed["target_host"] = await _read_socks_target(reader, atyp)
            observed["target_port"] = int.from_bytes(await reader.readexactly(2), "big")
            writer.write(b"\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00")
            await writer.drain()
            assert await reader.readexactly(4) == b"ping"
            writer.write(b"pong")
            await writer.drain()
            writer.close()
            await writer.wait_closed()

        transport = await asyncio.start_server(fake_transport, "127.0.0.1", 0)
        transport_port = transport.sockets[0].getsockname()[1]
        monkeypatch.setenv("X_REPLY_PROXY_TRANSPORT", f"socks5://127.0.0.1:{transport_port}")
        try:
            async with browser_compatible_proxy(
                "socks5://alice:s3cret@upstream.example:12324"
            ) as proxy_url:
                parsed = urlsplit(proxy_url)
                reader, writer = await asyncio.open_connection(parsed.hostname, parsed.port)
                writer.write(b"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n")
                await writer.drain()
                assert await reader.readuntil(b"\r\n\r\n") == b"HTTP/1.1 200 Connection Established\r\n\r\n"
                writer.write(b"ping")
                await writer.drain()
                assert await reader.readexactly(4) == b"pong"
                writer.close()
                await writer.wait_closed()
        finally:
            transport.close()
            await transport.wait_closed()

        assert observed == {
            "upstream_host": "upstream.example",
            "upstream_port": 12324,
            "username": "alice",
            "password": "s3cret",
            "target_host": "example.com",
            "target_port": 443,
        }

    asyncio.run(run())
