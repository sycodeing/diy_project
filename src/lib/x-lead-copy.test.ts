import assert from "node:assert/strict";
import test from "node:test";
import {
  createXLeadDrafts,
  getXLeadCopyOccasion,
  getXLeadShortCopyVariant,
  canAdvertiseFirstOrder25,
  createXLeadFirstContactDraft,
} from "./x-lead-copy.ts";
import { X_OUTREACH_GROUPS } from "./x-outreach-groups.ts";
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
  assert.deepEqual(new Set(assignments), new Set(["short_direct_b_v3", "guided_preview_a_v3"]));
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

test("new profile-based drafts use the v3 copy versions", () => {
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

  assert.match(drafts.variantKey, /^(short_direct_b_v3|guided_preview_a_v3)$/);
  assert.ok(drafts.publicCopy.length < 180);
});

test("advertises 25 percent only when the live offer covers every pillow variant", () => {
  const variants = [{ price_cents: 1999, currency: "usd" }];
  assert.equal(canAdvertiseFirstOrder25({ priceCents: 1499, currency: "USD" }, variants), true);
  assert.equal(canAdvertiseFirstOrder25(null, variants), false);
  assert.equal(canAdvertiseFirstOrder25({ priceCents: 1599, currency: "usd" }, variants), false);
  assert.equal(canAdvertiseFirstOrder25({ priceCents: 1499, currency: "eur" }, variants), false);
  assert.equal(canAdvertiseFirstOrder25({ priceCents: 1499, currency: "usd" }, []), false);
  assert.equal(canAdvertiseFirstOrder25({ priceCents: 1499, currency: "usd" }, [...variants, { price_cents: 1499, currency: "usd" }]), false);
});

test("all new copy scenes can include the verified first-order offer without product prices", () => {
  const context = { occasion: null, occasionConfidence: null, petType: "cat" as const, targetingData: null, firstOrderOffer: true };
  for (const group of Object.keys(X_OUTREACH_GROUPS) as Array<keyof typeof X_OUTREACH_GROUPS>) {
    for (const variant of ["short_direct_b_v3", "guided_preview_a_v3"] as const) {
      const draft = createXLeadDrafts(context, "https://example.com/go/test", undefined, variant, group);
      assert.match(draft.publicCopy, /25% off your first order/);
      assert.doesNotMatch(draft.publicCopy, /[$€£]|\bUSD\b|\d+\.\d{2}/i);
      assert.ok(draft.publicCopy.endsWith("https://example.com/go/test"));
      assert.ok(draft.publicCopy.length <= 220);
    }
  }
  for (const intent of [null, { tier: "exploratory", audience: "gift_exploration" }, { tier: "explicit_request", parent_post_id: "9000" }, { tier: "exploratory", scene: "decor" }]) {
    const draft = createXLeadFirstContactDraft({ ...context, targetingData: { purchase_intent: intent } });
    assert.match(draft.text, /first order is 25% off/);
    assert.doesNotMatch(draft.text, /[$€£]|\bUSD\b|\d+\.\d{2}/i);
    assert.ok(draft.text.length <= 280);
    const noOffer = createXLeadFirstContactDraft({ ...context, firstOrderOffer: false, targetingData: { purchase_intent: intent } });
    assert.doesNotMatch(noOffer.text, /25%|[$€£]|\bUSD\b|\d+\.\d{2}/i);
  }
});

test("future relationship scene draft does not claim a shared memory already happened", () => {
  const draft = createXLeadFirstContactDraft({
    occasion: null, occasionConfidence: null, firstOrderOffer: false,
    targetingData: { purchase_intent: { persona: "relationship_memory", experience_phase: "future_planned" } },
  });
  assert.match(draft.text, /important occasion/);
  assert.doesNotMatch(draft.text, /memory you shared|your photo|preview|25%/i);
});
