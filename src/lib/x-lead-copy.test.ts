import assert from "node:assert/strict";
import test from "node:test";
import {
  createXLeadDrafts,
  getXLeadCopyOccasion,
  getXLeadShortCopyVariant,
} from "./x-lead-copy.ts";
import { X_LEAD_MARKETING_CHANNEL } from "./x-lead-materials.ts";

test("attributes the X lead workflow to public replies", () => {
  assert.equal(X_LEAD_MARKETING_CHANNEL, "public_reply");
});

test("keeps scene-specific discovery separate from direct sales copy", () => {
  const context = {
    occasion: "pet_adventure",
    occasionConfidence: 88,
    petType: "dog" as const,
    targetingData: { matched_terms: ["hiking with my"] },
  };
  const drafts = createXLeadDrafts(context, "https://example.com/pet", undefined, "short_direct_a_v1");

  assert.equal(getXLeadCopyOccasion(context), "generic");
  assert.match(drafts.publicCopy, /great photo of your dog/i);
  assert.doesNotMatch(drafts.publicCopy, /hiking|permission|may i|would you/i);
});

test("keeps the legacy copy and adds an explicit guided-preview treatment", () => {
  const context = { occasion: null, occasionConfidence: null, petType: "cat" as const, targetingData: null };
  const link = "https://example.com/pet";
  const first = createXLeadDrafts(context, link, undefined, "short_direct_a_v1");
  const second = createXLeadDrafts(context, link, undefined, "short_direct_b_v1");
  const treatment = createXLeadDrafts(context, link, undefined, "guided_preview_a_v2");

  assert.equal(first.variantKey, "short_direct_a_v1");
  assert.equal(second.variantKey, "short_direct_b_v1");
  assert.equal(treatment.variantKey, "guided_preview_a_v2");
  assert.notEqual(first.publicCopy, second.publicCopy);
  assert.ok(first.publicCopy.endsWith(link));
  assert.ok(second.publicCopy.endsWith(link));
  assert.match(treatment.publicCopy, /open it.+photo already added/i);
  assert.ok(treatment.publicCopy.endsWith(link));
  assert.ok(first.publicCopy.length < 160);
  assert.ok(second.publicCopy.length < 160);
  assert.ok(treatment.publicCopy.length < 180);
  assert.equal(first.directMessageCopy, first.publicCopy);
  assert.equal(second.consentCopy, second.publicCopy);
});

test("assigns a stable experiment variant by lead seed", () => {
  const seeds = Array.from({ length: 50 }, (_, index) => `post-${index}`);
  const assignments = seeds.map(getXLeadShortCopyVariant);

  assert.deepEqual(assignments, seeds.map(getXLeadShortCopyVariant));
  assert.deepEqual(new Set(assignments), new Set(["short_direct_b_v1", "guided_preview_a_v2"]));
});

test("keeps a long-link direct message within the short-copy cap", () => {
  const link = `https://example.com/${"a".repeat(180)}`;
  const copy = createXLeadDrafts(
    { occasion: null, occasionConfidence: null, targetingData: null },
    link,
    undefined,
    "short_direct_b_v1",
  ).publicCopy;

  assert.ok(copy.length <= 220);
  assert.ok(copy.endsWith(link));
});

test("profile-based drafts resolve to the v2 control or guided treatment", () => {
  const drafts = createXLeadDrafts(
    { occasion: null, occasionConfidence: null, petType: "dog", targetingData: null },
    "https://example.com/pet",
    {
      accountKey: "warm_pet_account",
      style: "warm",
      voice: "friendly",
      positioning: "pet keepsakes",
      variationSeed: "task-one",
    },
  );

  assert.match(drafts.variantKey, /^(short_direct_b_v1|guided_preview_a_v2)$/);
  assert.ok(drafts.publicCopy.length < 180);
});
