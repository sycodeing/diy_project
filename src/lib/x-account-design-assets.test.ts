import assert from "node:assert/strict";
import test from "node:test";
import { createAccountDesignAsset, pickAccountTemplate, validAccountDesignAsset } from "./x-account-design-assets.ts";

const artworkHash = "a".repeat(64);
const previewHash = "b".repeat(64);
const asset = { artworkPath: `artwork/${artworkHash}.png`, artworkHash,
  previewPath: `preview/${artworkHash}/pillow-psd-03-grey-sofa-${previewHash}.webp`,
  previewHash, templateId: "pillow-psd-03-grey-sofa" };

test("account mockup identity binds flat artwork, rendered template and product family", () => {
  assert.equal(validAccountDesignAsset(asset, "custom-pillow"), true);
  assert.equal(validAccountDesignAsset(asset, "face-towel"), false);
  assert.equal(validAccountDesignAsset({ ...asset, previewHash: "c".repeat(64) }, "custom-pillow"), false);
  assert.equal(validAccountDesignAsset({ ...asset, artworkPath: "artwork/../source.png" }, "custom-pillow"), false);
  assert.equal(pickAccountTemplate({ slug: "custom-pillow", name: "Pillow", variants: [],
    mockupTemplateIds: ["pillow-psd-03-grey-sofa"] }), "pillow-psd-03-grey-sofa");
  assert.equal(pickAccountTemplate({ slug: "face-towel", name: "Towel", variants: [],
    mockupTemplateIds: ["pillow-psd-03-grey-sofa"] }), null);
});

test("upload rejects invalid bytes before rendering or storage", async () => {
  await assert.rejects(createAccountDesignAsset(new File(["not an image"], "fake.png", { type: "image/png" }),
    { slug: "custom-pillow", name: "Pillow", variants: [], mockupTemplateIds: ["pillow-psd-03-grey-sofa"] }), /valid, near-square PNG\/WebP/);
});
