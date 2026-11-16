import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner needs explicit extensions.
import { getXLeadPreviewSourceHash } from "./x-lead-preview-identity.ts";

test("preview cache identity changes when an owner chooses a different photo", () => {
  const secret = "test-secret";
  const first = getXLeadPreviewSourceHash(secret, "post-1", "https://img.example/first.jpg");
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, getXLeadPreviewSourceHash(secret, "post-1", "https://img.example/first.jpg"));
  assert.notEqual(first, getXLeadPreviewSourceHash(secret, "post-1", "https://img.example/second.jpg"));
  assert.notEqual(first, getXLeadPreviewSourceHash(secret, "post-2", "https://img.example/first.jpg"));
});
