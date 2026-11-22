import assert from "node:assert/strict";
import test from "node:test";
import { marketingDestinationPath, marketingLinkRequestSchema } from "./marketing-link-request.ts";

const base = { campaign: "account_review_draft", channel: "public_reply", variant: "account_context_v1",
  sourceHash: "a".repeat(64) };

test("account link needs a supported product, and legacy image link still parses", () => {
  assert.equal(marketingLinkRequestSchema.safeParse({ ...base, productSlug: "custom-pillow" }).success, true);
  assert.equal(marketingLinkRequestSchema.safeParse({ ...base, productSlug: "face-towel" }).success, true);
  assert.equal(marketingLinkRequestSchema.safeParse({ ...base, sourceImageUrl: "https://pbs.twimg.com/media/example.jpg" }).success, true);
  assert.equal(marketingLinkRequestSchema.safeParse({ ...base }).success, false);
  assert.equal(marketingLinkRequestSchema.safeParse({ ...base, productSlug: "custom-pillow",
    sourceImageUrl: "https://pbs.twimg.com/media/example.jpg" }).success, false);
  assert.equal(marketingLinkRequestSchema.safeParse({ ...base, productSlug: "not-active" }).success, false);
});

test("text-only product link uses the selected design page and never silently substitutes pillow", () => {
  assert.equal(marketingDestinationPath("face-towel", new Set(["face-towel"])), "/design?product=face-towel");
  assert.equal(marketingDestinationPath("face-towel", new Set(["custom-pillow"])), "/products?unavailable=1");
  assert.equal(marketingDestinationPath("custom-pillow", new Set()), "/products?unavailable=1");
  assert.equal(marketingDestinationPath(null, new Set()), "/design");
});
