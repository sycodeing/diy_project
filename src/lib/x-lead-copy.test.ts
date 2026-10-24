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
  assert.match(drafts.publicCopy, /absolutely adorable/i);
  assert.doesNotMatch(drafts.publicCopy, /happy birthday|birthday keepsake/i);
});

test("uses birthday copy only with confident explicit birthday evidence", () => {
  const context = {
    occasion: "pet_birthday",
    occasionConfidence: 88,
    targetingData: { matched_terms: ["happy birthday"] },
  };

  assert.equal(getXLeadCopyOccasion(context), "birthday");
  assert.match(createXLeadDrafts(context).publicCopy, /Happy birthday/);
});

test("uses adoption copy only with confident adoption evidence", () => {
  const context = {
    occasion: "new_adoption",
    occasionConfidence: 88,
    targetingData: { post_excerpt: "We adopted this pup today. Welcome home!" },
  };

  assert.equal(getXLeadCopyOccasion(context), "adoption");
  assert.match(createXLeadDrafts(context).publicCopy, /new family member/i);
});

test("keeps a long-link public reply within the X character limit", () => {
  const link = `https://example.com/${"a".repeat(180)}`;
  const copy = createXLeadDrafts({ occasion: null, occasionConfidence: null, targetingData: null }, link).publicCopy;

  assert.ok(copy.length <= 270);
  assert.ok(copy.endsWith(link));
});
