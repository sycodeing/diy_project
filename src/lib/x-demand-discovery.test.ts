import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node test runner uses explicit TypeScript extensions.
import { demandSearchConfigurationSchema, getXLeadPhotoSource, getXLeadPurchaseIntent } from "./x-lead.ts";
// @ts-expect-error Node test runner uses explicit TypeScript extensions.
import { buildXLeadDiscoveryUpsertRow, hasVerifiedDemandPhotoSource, type XLeadDiscoveryCandidate } from "./x-lead-discovery-upsert.ts";
// @ts-expect-error Node test runner uses explicit TypeScript extensions.
import { supportsDemandPhotoJoin } from "./x-lead-worker-version.ts";

test("old workers cannot claim new demand-photo jobs", () => {
  assert.equal(supportsDemandPhotoJoin("1.8.0"), false);
  assert.equal(supportsDemandPhotoJoin("1.9.0"), true);
  assert.equal(supportsDemandPhotoJoin(undefined), false);
  assert.equal(supportsDemandPhotoJoin("2.0.0"), true);
});

test("demand configuration is bounded and cannot weaken US gates or mix legacy slices", () => {
  const base = { segments: ["demand_custom"], resultLimit: 60, lookbackDays: 7 };
  assert.equal(demandSearchConfigurationSchema.parse(base).usRequired, true);
  assert.equal(demandSearchConfigurationSchema.parse(base).qualifiedPerScene, 20);
  assert.equal(demandSearchConfigurationSchema.parse({ ...base, segments: ["demand_reply"] }).segments[0], "demand_reply");
  for (const patch of [{ segments: ["new_adoption"] }, { usRequired: false }, { usMinConfidence: 69 }, { resultLimit: 101 }, { lookbackDays: 30 }, { qualifiedPerScene: 0 }, { qualifiedPerScene: 101 }]) {
    assert.equal(demandSearchConfigurationSchema.safeParse({ ...base, ...patch }).success, false);
  }
});

test("three scenes have independent targets without changing the raw retrieval budget", () => {
  const config = demandSearchConfigurationSchema.parse({ segments: ["demand_custom", "demand_gift", "demand_decor"], resultLimit: 90, lookbackDays: 3, qualifiedPerScene: 10 });
  assert.equal(config.resultLimit, 90);
  assert.equal(config.qualifiedPerScene, 10);
  assert.equal(getXLeadPurchaseIntent({ targeting_data: { purchase_intent: { tier: "explicit_request", scene: "gift" } } })?.scene, "gift");
});

test("evidence renderer rejects malformed metadata", () => {
  assert.equal(getXLeadPurchaseIntent({ targeting_data: { purchase_intent: "yes" } }), null);
  assert.equal(getXLeadPurchaseIntent({ targeting_data: { purchase_intent: { tier: "excluded" } } }), null);
  assert.equal(getXLeadPurchaseIntent({ targeting_data: { purchase_intent: { tier: "explicit_request", evidence: ["original text", 42], score: 80 } } })?.evidence, "original text");
  assert.equal(getXLeadPurchaseIntent({ targeting_data: { purchase_intent: {
    tier: "exploratory", scene: "gift", audience: "gift_exploration",
  } } })?.label, "宠物主人送礼需求 · 探索组（待验证）");
});

test("demand card only treats a verified matching image as a separate photo source", () => {
  const base = {
    media_url: "https://pbs.twimg.com/media/dog.jpg",
    post_url: "https://x.com/owner/status/1",
    targeting_data: { photo_source: {
      post_id: "2", post_url: "https://x.com/owner/status/2", relationship: "same_account",
      selected_media_url: "https://pbs.twimg.com/media/dog.jpg", verification_result: "verified",
      post_excerpt: "My dog at home",
    } },
  };
  assert.equal(getXLeadPhotoSource(base)?.postUrl, "https://x.com/owner/status/2");
  assert.equal(getXLeadPhotoSource({ ...base, media_url: "https://pbs.twimg.com/media/other.jpg" }), null);
  assert.equal(getXLeadPhotoSource({ ...base, targeting_data: { photo_source: { ...base.targeting_data.photo_source, verification_result: "pending" } } }), null);
  assert.equal(getXLeadPhotoSource({ ...base, targeting_data: { photo_source: { ...base.targeting_data.photo_source, post_url: "javascript:alert(1)" } } }), null);
});

test("hosted import refuses demand leads without matching verified photo provenance", () => {
  const base: XLeadDiscoveryCandidate = {
    postId: "1", authorHash: "a".repeat(64), handle: "owner", postUrl: "https://x.com/owner/status/1",
    mediaUrl: "https://img.example/dog.jpg", selectionStatus: "targeting_review", segment: "custom", petType: "dog",
    likeCount: 0, replyCount: 0, repostCount: 0, viewCount: 0, followersCount: 0,
    targetingData: { discovery_mode: "purchase_intent", demand_author_id: "account-1", image_verification: {
      result: "verified", media_url: "https://img.example/dog.jpg",
    }, photo_source: {
      post_id: "2", post_url: "https://x.com/owner/status/2", author_id: "account-1", author_handle: "owner",
      relationship: "same_account", selected_media_url: "https://img.example/dog.jpg", verification_result: "verified",
    } },
  };
  assert.equal(hasVerifiedDemandPhotoSource(base), true);
  assert.equal(hasVerifiedDemandPhotoSource({ ...base, targetingData: { ...base.targetingData, photo_source: undefined } }), false);
  assert.equal(hasVerifiedDemandPhotoSource({ ...base, targetingData: { ...base.targetingData, demand_author_id: "different" } }), false);
  assert.equal(hasVerifiedDemandPhotoSource({ ...base, mediaUrl: "https://img.example/other.jpg" }), false);
});

test("legacy rediscovery retains demand evidence without overriding human decisions", () => {
  const intent = { tier: "explicit_request", score: 80, evidence: ["Where can I order a portrait of my dog?"] };
  const existing = { post_id: "1", selection_status: "targeting_review", source_job_id: "original", discovered_at: "2026-11-01", targeting_data: { purchase_intent: intent, discovery_mode: "purchase_intent" } };
  const candidate: XLeadDiscoveryCandidate = {
    postId: "1", authorHash: "a".repeat(64), handle: "owner", postUrl: "https://x.com/owner/status/1",
    mediaUrl: "https://example.com/dog.jpg", selectionStatus: "targeting_review", segment: "custom", petType: "dog",
    likeCount: 0, replyCount: 0, repostCount: 0, viewCount: 0, followersCount: 0, targetingData: { post_excerpt: "same text" },
  };
  const row = buildXLeadDiscoveryUpsertRow({ candidate, existing, jobId: "new", discoveredAt: "today" });
  assert.equal(row.source_job_id, "original");
  assert.deepEqual(row.targeting_data.purchase_intent, intent);
  assert.equal(row.targeting_data.legacy_eligible, true);
  const rejected = buildXLeadDiscoveryUpsertRow({ candidate, existing: { ...existing, selection_status: "rejected" }, jobId: "new", discoveredAt: "today" });
  assert.equal(rejected.selection_status, "rejected");
  assert.deepEqual(rejected.targeting_data, existing.targeting_data);
});
