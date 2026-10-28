import assert from "node:assert/strict";
import test from "node:test";
import { createXLeadDrafts, getXLeadCopyOccasion } from "./x-lead-copy.ts";

test("uses generic copy for a birthday search result without birthday evidence", () => {
  const context = {
    occasion: "pet_birthday",
    occasionConfidence: 35,
    targetingData: { post_excerpt: "My dog was extra cute at the park today." },
  };
  const drafts = createXLeadDrafts(context, "https://example.com/pet");

  assert.equal(getXLeadCopyOccasion(context), "generic");
  assert.match(drafts.publicCopy, /adorable|sweet|wonderful|heartwarming|personality|beautiful/i);
  assert.doesNotMatch(drafts.publicCopy, /happy birthday|birthday keepsake/i);
});

test("uses generic cute-pet copy even with confident explicit birthday evidence", () => {
  const context = {
    occasion: "pet_birthday",
    occasionConfidence: 88,
    targetingData: { matched_terms: ["happy birthday"] },
  };

  const copy = createXLeadDrafts(context).publicCopy;
  assert.equal(getXLeadCopyOccasion(context), "generic");
  assert.match(copy, /adorable|sweet|wonderful/i);
  assert.doesNotMatch(copy, /birthday|barkday/i);
});

test("uses generic cute-pet copy even with confident adoption evidence", () => {
  const context = {
    occasion: "new_adoption",
    occasionConfidence: 88,
    targetingData: { post_excerpt: "We adopted this pup today. Welcome home!" },
  };

  const copy = createXLeadDrafts(context).publicCopy;
  assert.equal(getXLeadCopyOccasion(context), "generic");
  assert.match(copy, /adorable|sweet|wonderful/i);
  assert.doesNotMatch(copy, /adopt|new family member|welcome.home/i);
});

test("keeps a long-link public reply within the X character limit", () => {
  const link = `https://example.com/${"a".repeat(180)}`;
  const copy = createXLeadDrafts({ occasion: null, occasionConfidence: null, targetingData: null }, link).publicCopy;

  assert.ok(copy.length <= 270);
  assert.ok(copy.endsWith(link));
});

test("varies copy by account profile and by individual task while preserving the link", () => {
  const context = { occasion: null, occasionConfidence: null, targetingData: null };
  const profile = {
    accountKey: "warm_pet_account",
    style: "warm" as const,
    voice: "gentle and specific",
    positioning: "pet keepsakes",
    variationSeed: "task-one",
  };
  const first = createXLeadDrafts(context, "https://example.com/a", profile);
  const second = createXLeadDrafts(context, "https://example.com/a", { ...profile, variationSeed: "task-two" });
  const playful = createXLeadDrafts(context, "https://example.com/a", {
    ...profile,
    accountKey: "playful_pet_account",
    style: "playful",
  });

  assert.notEqual(first.variantKey, second.variantKey);
  assert.notEqual(first.publicCopy, playful.publicCopy);
  assert.ok(first.publicCopy.endsWith("https://example.com/a"));
  assert.ok(playful.publicCopy.length <= 270);
});

test("produces broad deterministic variation across manual queue tasks", () => {
  const context = {
    occasion: null,
    occasionConfidence: null,
    petType: "dog" as const,
    targetingData: { post_excerpt: "My dog enjoying a sunny afternoon." },
  };
  const copies = Array.from({ length: 24 }, (_, index) => createXLeadDrafts(context, "https://example.com/pet", {
    accountKey: "manual-review",
    style: "warm",
    voice: "warm, specific, and respectful",
    positioning: "private custom pet keepsake previews",
    variationSeed: `lead-${index}:task-${index}`,
  }).publicCopy);

  assert.ok(new Set(copies).size >= 16);
  assert.ok(copies.every((copy) => copy.endsWith("https://example.com/pet")));
  assert.ok(copies.every((copy) => copy.length <= 270));
});

test("uses candidate context to vary unprofiled drafts while remaining deterministic", () => {
  const firstContext = { occasion: null, occasionConfidence: null, petType: "cat" as const, targetingData: { post_excerpt: "My cat watching birds." } };
  const secondContext = { occasion: null, occasionConfidence: null, petType: "dog" as const, targetingData: { post_excerpt: "My dog at the beach." } };

  const first = createXLeadDrafts(firstContext);
  assert.equal(first.publicCopy, createXLeadDrafts(firstContext).publicCopy);
  assert.notEqual(first.publicCopy, createXLeadDrafts(secondContext).publicCopy);
});
