import hashlib
import hmac

from lead_studio.marketing import signed_headers


def test_hmac_signature_matches_server_canonical_form():
    body = b'{"campaign":"pets"}'
    secret = "s" * 32
    headers = signed_headers(body, "x-lead:1:test:public_reply:a", secret, now=1_700_000_000, nonce="n" * 24)
    canonical = b"1700000000\n" + b"n" * 24 + b"\nx-lead:1:test:public_reply:a\n" + body
    expected = hmac.new(secret.encode(), canonical, hashlib.sha256).hexdigest()
    assert headers["x-marketing-signature"] == expected
