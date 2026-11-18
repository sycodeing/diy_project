import assert from "node:assert/strict";
import test from "node:test";
import { xLeadRawReviewSchema } from "./x-lead-raw-review.ts";

const base = {
  postId: "123", authorId: "author", handle: "cat_sitter",
  postUrl: "https://x.com/cat_sitter/status/123", postText: "",
  postedAt: "2026-11-18T07:30:00+00:00", sourceArchive: "archive.json",
  sourceStage: "shopping_broad", classifierVersion: "v8",
  classifierTier: "excluded", exclusionReasons: [], intent: {},
  bodyTopicMatch: false, isReply: false, parentPostId: null,
  parentStatus: "not_applicable", parentEvidence: null, parentSourceArchive: null,
};

test("raw review text bound uses JavaScript UTF-16 length", () => {
  const valid = "🐈".repeat(40) + "x".repeat(2920);
  assert.equal(valid.length, 3000);
  assert.equal(xLeadRawReviewSchema.safeParse({ ...base, postText: valid }).success, true);
  assert.equal(xLeadRawReviewSchema.safeParse({ ...base, postText: valid + "x" }).success, false);
});
