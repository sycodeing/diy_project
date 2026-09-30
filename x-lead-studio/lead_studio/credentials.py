from __future__ import annotations

import ctypes
from ctypes import wintypes
from pathlib import Path


class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _blob(data: bytes) -> tuple[DATA_BLOB, object]:
    buffer = ctypes.create_string_buffer(data)
    return DATA_BLOB(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte))), buffer


def protect(value: str) -> bytes:
    if not hasattr(ctypes, "windll"):
        raise RuntimeError("X cookies can only be stored with Windows DPAPI.")
    source, source_buffer = _blob(value.encode("utf-8"))
    output = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(source), "x-lead-studio", None, None, None, 0, ctypes.byref(output)
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)
        del source_buffer


def unprotect(value: bytes) -> str:
    source, source_buffer = _blob(value)
    output = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(source), None, None, None, None, 0, ctypes.byref(output)
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData).decode("utf-8")
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)
        del source_buffer


def save_cookie(path: Path, cookie: str) -> None:
    if "auth_token=" not in cookie or "ct0=" not in cookie:
        raise ValueError("Cookie must contain auth_token and ct0.")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(protect(cookie))


def load_cookie(path: Path) -> str:
    if not path.exists():
        raise RuntimeError("Import the self-owned X account cookie first.")
    return unprotect(path.read_bytes())
