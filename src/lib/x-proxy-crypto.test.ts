import assert from "node:assert/strict";
import test from "node:test";
import { decryptProxyUrl, encryptProxyUrl, getProxyDisplayHost, maskProxyUrl, normalizeProxyUrl } from "./x-proxy-crypto.ts";

const secret = "test-secret-that-is-at-least-thirty-two-bytes-long";

test("encrypts and decrypts an authenticated proxy without exposing credentials", () => {
  const input = "http://proxy-user:proxy-pass@us.example.test:9000";
  const encrypted = encryptProxyUrl(input, secret);
  assert.doesNotMatch(encrypted, /proxy-user|proxy-pass/);
  assert.equal(decryptProxyUrl(encrypted, secret), input);
  assert.equal(maskProxyUrl(input), "http://***@us.example.test:9000");
  assert.equal(getProxyDisplayHost(input), "us.example.test:9000");
});

test("rejects unsupported proxy schemes and missing ports", () => {
  assert.throws(() => normalizeProxyUrl("ftp://example.test:21"), /仅支持/);
  assert.throws(() => normalizeProxyUrl("https://example.test"), /端口/);
});

test("rejects ciphertext encrypted with a different worker secret", () => {
  const encrypted = encryptProxyUrl("socks5://127.0.0.1:1080", secret);
  assert.throws(() => decryptProxyUrl(encrypted, `${secret}-different`), /无法解密/);
});
