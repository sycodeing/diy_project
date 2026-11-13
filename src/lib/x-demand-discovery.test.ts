import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node test runner uses explicit TypeScript extensions.
import { demandSearchConfigurationSchema, getXLeadPurchaseIntent } from "./x-lead.ts";
// @ts-expect-error Node test runner uses explicit TypeScript extensions.
import { buildXLeadDiscoveryUpsertRow, type XLeadDiscoveryCandidate } from "./x-lead-discovery-upsert.ts";

test("demand configuration is bounded and cannot weaken US gates or mix legacy slices", () => {
  const base = { segments: ["demand_custom"], resultLimit: 60, lookbackDays: 7 };
  assert.equal(demandSearchConfigurationSchema.parse(base).usRequired, true);
  for (const patch of [{ segments: ["new_adoption"] }, { usRequired: false }, { usMinConfidence: 69 }, { resultLimit: 101 }, { lookbackDays: 30 }]) {
    assert.equal(demandSearchConfigurationSchema.safeParse({ ...base, ...patch }).success, false);
  }
});

test("evidence renderer rejects malformed metadata", () => {
  assert.equal(getXLeadPurchaseIntent({ targeting_data: { purchase_intent: "yes" } }), null);
  assert.equal(getXLeadPurchaseIntent({ targeting_data: { purchase_intent: { tier: "excluded" } } }), null);
  assert.equal(getXLeadPurchaseIntent({ targeting_data: { purchase_intent: { tier: "explicit_request", evidence: ["original text", 42], score: 80 } } })?.evidence, "original text");
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
