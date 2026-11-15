import assert from "node:assert/strict";
import test from "node:test";
import { promotionalPrice } from "./first-order-promotion";

const promotion = { key: "first_order", priceCents: 1499, currency: "usd" };

test("first-order promotion applies across products in its currency", () => {
  assert.equal(promotionalPrice(1999, "usd", promotion), 1499);
  assert.equal(promotionalPrice(1999, "eur", promotion), 1999);
  assert.equal(promotionalPrice(1999, "usd", null), 1999);
});

test("a promotion never raises or matches the regular price", () => {
  assert.equal(promotionalPrice(1299, "usd", promotion), 1299);
  assert.equal(promotionalPrice(1499, "usd", promotion), 1499);
});
