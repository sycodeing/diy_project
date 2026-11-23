import assert from "node:assert/strict";
import test from "node:test";
import { reuseManualAccountPreview } from "./x-account-manual-preview.ts";

test("ordinary prepare preserves valid manual artwork and fails closed if its link expires", async () => {
  let checks = 0;
  assert.equal(await reuseManualAccountPreview("brand_created", { visibleMotifs: "original leaves" }, false,
    async () => { checks++; return true; }), true);
  assert.equal(checks, 1);
  await assert.rejects(reuseManualAccountPreview("brand_created", {}, false, async () => false), /已失效/);
});

test("explicit regeneration may replace manual artwork while procedural and seed drafts take auto path", async () => {
  const never = async () => { throw new Error("should not validate"); };
  assert.equal(await reuseManualAccountPreview("brand_created", {}, true, never), false);
  assert.equal(await reuseManualAccountPreview("brand_created", { generationMethod: "procedural" }, false, never), false);
  assert.equal(await reuseManualAccountPreview(null, {}, false, never), false);
});
