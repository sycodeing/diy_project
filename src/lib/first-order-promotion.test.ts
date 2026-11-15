import assert from "node:assert/strict";
import test from "node:test";
import { promotionalPrice } from "./first-order-promotion";

const promotion = { key: "first_order", productSlug: "custom-pillow", priceCents: 1499, currency: "usd" };

test("first-order promotion applies only to its product and currency", () => {
  assert.equal(promotionalPrice(1999, "usd", "custom-pillow", promotion), 1499);
  assert.equal(promotionalPrice(1999, "usd", "other-product", promotion), 1999);
  assert.equal(promotionalPrice(1999, "eur", "custom-pillow", promotion), 1999);
  assert.equal(promotionalPrice(1999, "usd", "custom-pillow", null), 1999);
});

test("a promotion never raises or matches the regular price", () => {
  assert.equal(promotionalPrice(1299, "usd", "custom-pillow", promotion), 1299);
  assert.equal(promotionalPrice(1499, "usd", "custom-pillow", promotion), 1499);
});
