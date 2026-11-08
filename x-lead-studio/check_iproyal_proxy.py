"""Read-only preflight for an IPRoyal ISP proxy before binding it to an X account.

Usage: python check_iproyal_proxy.py --file /private/proxies.txt --host 1.2.3.4
The input file is host:port:username:password. Credentials never appear in output
or command-line arguments sent to curl.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import subprocess
from pathlib import Path


IP_CHECK_URL = "https://api64.ipify.org?format=json"
X_CHECK_URL = "https://x.com/robots.txt"
IPROYAL_ISP_SOCKS5_PORT = 12324


def read_credentials(path: Path, host: str) -> tuple[str, str]:
    ipaddress.ip_address(host)
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split(":", 3)
        if len(parts) == 4 and parts[0] == host:
            _, _listed_port, username, password = parts
            if not username or not password or any(any(char in item for char in ('\n', '\r', '"', '\\')) for item in (username, password)):
                raise ValueError("Invalid proxy credentials in the local file.")
            return username, password
    raise ValueError(f"Proxy IP {host} was not found in the local file.")


def probe(host: str, username: str, password: str, url: str) -> tuple[int, str]:
    # IPRoyal ISP's default HTTP port is 12323; 12324 is SOCKS5. Use the
    # protocol-specific port, even when the exported list used HTTP settings.
    config = f'proxy = "socks5h://{host}:{IPROYAL_ISP_SOCKS5_PORT}"\nproxy-user = "{username}:{password}"\n'
    result = subprocess.run(
        ["curl", "-q", "--config", "-", "--silent", "--show-error", "--fail", "--max-time", "20", url],
        input=config,
        text=True,
        capture_output=True,
        timeout=25,
        check=False,
    )
    return result.returncode, result.stdout if result.returncode == 0 else ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Test an IPRoyal ISP SOCKS5 route and X access without sending anything.")
    parser.add_argument("--file", type=Path, required=True, help="Local IPRoyal host:port:user:password export")
    parser.add_argument("--host", required=True, help="IP assigned to the X account")
    args = parser.parse_args()
    try:
        username, password = read_credentials(args.file, args.host)
        ip_code, ip_body = probe(args.host, username, password, IP_CHECK_URL)
        if ip_code:
            print("Proxy egress probe failed; check the SOCKS5 port, credentials and connectivity.")
            return 1
        observed_ip = json.loads(ip_body).get("ip")
        if observed_ip != args.host:
            print(f"Proxy egress mismatch: expected {args.host}, observed {observed_ip}.")
            return 1
        x_code, x_body = probe(args.host, username, password, X_CHECK_URL)
        if x_code or not x_body:
            print(f"Proxy egress {observed_ip} confirmed, but X is unreachable through this route.")
            return 1
        print(f"Proxy egress {observed_ip} and read-only X access confirmed via SOCKS5:{IPROYAL_ISP_SOCKS5_PORT}.")
        return 0
    except (OSError, ValueError, json.JSONDecodeError, subprocess.TimeoutExpired):
        print("Proxy preflight failed; check the local file, credentials and connectivity.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
