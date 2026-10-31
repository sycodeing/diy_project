import assert from "node:assert/strict";
import test from "node:test";
import { createLegacyMarketingAlias, createMarketingLinkTokens } from "./marketing-token.ts";

test("creates a stable short token while retaining the legacy token", () => {
  const first = createMarketingLinkTokens("s".repeat(32), "x-link:example");
  const second = createMarketingLinkTokens("s".repeat(32), "x-link:example");

  assert.deepEqual(first, second);
  assert.match(first.preferred, /^[A-Za-z0-9_-]{12}$/);
  assert.match(first.legacy, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.preferred, first.legacy);
});

test("creates a stable 12-character alias for existing hashed links", () => {
  const alias = createLegacyMarketingAlias("ab".repeat(32));

  assert.equal(alias.length, 12);
  assert.match(alias, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(createLegacyMarketingAlias("ab".repeat(32)), alias);
});
