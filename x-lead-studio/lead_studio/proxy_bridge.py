from __future__ import annotations

import asyncio
import ipaddress
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from urllib.parse import unquote, urlsplit


MAX_HEADER_BYTES = 64 * 1024
CONNECT_TIMEOUT_SECONDS = 30


def _authenticated_socks5(value: str | None) -> tuple[str, int, str, str] | None:
    if not value:
        return None
    parsed = urlsplit(value)
    if parsed.scheme != "socks5" or parsed.username is None:
        return None
    if not parsed.hostname or not parsed.port or parsed.password is None:
        raise ValueError("Authenticated SOCKS5 proxy requires host, port, username, and password.")
    username = unquote(parsed.username)
    password = unquote(parsed.password)
    if not username or not password or len(username.encode()) > 255 or len(password.encode()) > 255:
        raise ValueError("SOCKS5 proxy credentials are invalid.")
    return parsed.hostname, parsed.port, username, password


async def _read_socks_address(reader: asyncio.StreamReader, atyp: int) -> None:
    if atyp == 1:
        await reader.readexactly(4)
    elif atyp == 3:
        length = (await reader.readexactly(1))[0]
        await reader.readexactly(length)
    elif atyp == 4:
        await reader.readexactly(16)
    else:
        raise ConnectionError("SOCKS5 proxy returned an invalid address type.")
    await reader.readexactly(2)


async def _connect_upstream(
    upstream: tuple[str, int, str, str],
    target_host: str,
    target_port: int,
) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    proxy_host, proxy_port, username, password = upstream
    reader, writer = await asyncio.wait_for(
        asyncio.open_connection(proxy_host, proxy_port),
        timeout=CONNECT_TIMEOUT_SECONDS,
    )
    try:
        writer.write(b"\x05\x01\x02")
        await writer.drain()
        if await reader.readexactly(2) != b"\x05\x02":
            raise PermissionError("SOCKS5 proxy rejected username/password authentication.")

        username_bytes = username.encode()
        password_bytes = password.encode()
        writer.write(
            b"\x01"
            + bytes((len(username_bytes),))
            + username_bytes
            + bytes((len(password_bytes),))
            + password_bytes
        )
        await writer.drain()
        if await reader.readexactly(2) != b"\x01\x00":
            raise PermissionError("SOCKS5 proxy credentials were rejected.")

        try:
            address = ipaddress.ip_address(target_host)
        except ValueError:
            host_bytes = target_host.encode("idna")
            if not host_bytes or len(host_bytes) > 255:
                raise ValueError("Proxy target hostname is invalid.")
            encoded_target = b"\x03" + bytes((len(host_bytes),)) + host_bytes
        else:
            encoded_target = (b"\x01" if address.version == 4 else b"\x04") + address.packed

        writer.write(b"\x05\x01\x00" + encoded_target + target_port.to_bytes(2, "big"))
        await writer.drain()
        version, result, _reserved, atyp = await reader.readexactly(4)
        if version != 5:
            raise ConnectionError("SOCKS5 proxy returned an invalid response.")
        await _read_socks_address(reader, atyp)
        if result != 0:
            raise ConnectionError(f"SOCKS5 proxy could not connect to the target (code {result}).")
        return reader, writer
    except BaseException:
        writer.close()
        await writer.wait_closed()
        raise


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(64 * 1024):
            writer.write(data)
            await writer.drain()
    except (ConnectionError, asyncio.IncompleteReadError):
        pass


@dataclass
class AuthenticatedSocks5Bridge:
    upstream: tuple[str, int, str, str]
    server: asyncio.Server | None = None
    clients: set[asyncio.Task[None]] = field(default_factory=set)

    async def start(self) -> str:
        self.server = await asyncio.start_server(self._accept, "127.0.0.1", 0)
        socket = self.server.sockets[0]
        return f"http://127.0.0.1:{socket.getsockname()[1]}"

    async def close(self) -> None:
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        for task in tuple(self.clients):
            task.cancel()
        if self.clients:
            await asyncio.gather(*self.clients, return_exceptions=True)

    def _accept(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        task = asyncio.create_task(self._handle(reader, writer))
        self.clients.add(task)
        task.add_done_callback(self.clients.discard)

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        upstream_writer: asyncio.StreamWriter | None = None
        try:
            header = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=CONNECT_TIMEOUT_SECONDS)
            if len(header) > MAX_HEADER_BYTES:
                raise ValueError("Proxy request header is too large.")
            request_line = header.split(b"\r\n", 1)[0].decode("ascii", errors="strict")
            method, authority, _version = request_line.split(" ", 2)
            if method.upper() != "CONNECT":
                writer.write(b"HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n")
                await writer.drain()
                return
            host, separator, port_value = authority.rpartition(":")
            if not separator or not host:
                raise ValueError("CONNECT target is invalid.")
            target_host = host.strip("[]")
            target_port = int(port_value)
            if not 1 <= target_port <= 65535:
                raise ValueError("CONNECT target port is invalid.")

            upstream_reader, upstream_writer = await _connect_upstream(self.upstream, target_host, target_port)
            writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            await writer.drain()
            relay_tasks = {
                asyncio.create_task(_pipe(reader, upstream_writer)),
                asyncio.create_task(_pipe(upstream_reader, writer)),
            }
            _done, pending = await asyncio.wait(relay_tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*relay_tasks, return_exceptions=True)
        except (Exception, asyncio.TimeoutError):
            if not writer.is_closing():
                writer.write(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
                try:
                    await writer.drain()
                except ConnectionError:
                    pass
        finally:
            if upstream_writer and not upstream_writer.is_closing():
                upstream_writer.close()
            if not writer.is_closing():
                writer.close()
            await asyncio.gather(
                *(item.wait_closed() for item in (upstream_writer, writer) if item is not None),
                return_exceptions=True,
            )


@asynccontextmanager
async def browser_compatible_proxy(proxy_url: str | None):
    """Translate authenticated SOCKS5 into a loopback HTTP CONNECT proxy for Chromium."""
    upstream = _authenticated_socks5(proxy_url)
    if upstream is None:
        yield proxy_url
        return
    bridge = AuthenticatedSocks5Bridge(upstream)
    local_url = await bridge.start()
    try:
        yield local_url
    finally:
        await bridge.close()
