import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedRawPhotoUrl, preserveOmittedRawPhotos, xLeadRawReviewSchema } from "./x-lead-raw-review.ts";

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

test("raw photo schema accepts only trusted original media URLs", () => {
  const good = "https://pbs.twimg.com/media/photo.jpg";
  assert.equal(xLeadRawReviewSchema.safeParse({ ...base, photoUrls: [good] }).success, true);
  assert.equal(xLeadRawReviewSchema.safeParse(base).success, true); // old worker
  for (const bad of ["http://pbs.twimg.com/media/photo.jpg", "https://pbs.twimg.com.evil.test/media/photo.jpg",
    "https://pbs.twimg.com/profile_images/avatar.jpg", "https://pbs.twimg.com:444/media/photo.jpg"]) {
    assert.equal(isTrustedRawPhotoUrl(bad), false);
    assert.equal(xLeadRawReviewSchema.safeParse({ ...base, photoUrls: [bad] }).success, false);
  }
  assert.equal(xLeadRawReviewSchema.safeParse({ ...base, photoUrls: Array(5).fill(good) }).success, false);
});

test("omitted old-worker photos are preserved; explicit empty photos clear", () => {
  const current = [{ post_id: "123", photo_urls: ["https://pbs.twimg.com/media/photo.jpg"] }];
  assert.deepEqual(preserveOmittedRawPhotos([{ post_id: "123" }], current)[0].photo_urls, current[0].photo_urls);
  assert.deepEqual(preserveOmittedRawPhotos([{ post_id: "123", photo_urls: [] }], current)[0].photo_urls, []);
});
