import hashlib
import hmac

from lead_studio.app import _marketing_lead_payload
from lead_studio.marketing import signed_headers


def test_hmac_signature_matches_server_canonical_form():
    body = b'{"campaign":"pets"}'
    secret = "s" * 32
    headers = signed_headers(body, "x-lead:1:test:public_reply:a", secret, now=1_700_000_000, nonce="n" * 24)
    canonical = b"1700000000\n" + b"n" * 24 + b"\nx-lead:1:test:public_reply:a\n" + body
    expected = hmac.new(secret.encode(), canonical, hashlib.sha256).hexdigest()
    assert headers["x-marketing-signature"] == expected


def test_marketing_payload_links_public_x_identity_to_local_lead():
    payload = _marketing_lead_payload({
        "post_id": "123",
        "author_hash": "a" * 64,
        "author_handle": "pet_owner",
        "post_url": "https://x.com/pet_owner/status/123",
        "score": 82,
    }, 17)
    assert payload == {
        "leadId": "17",
        "authorHash": "a" * 64,
        "handle": "pet_owner",
        "postId": "123",
        "postUrl": "https://x.com/pet_owner/status/123",
        "score": 82,
    }
