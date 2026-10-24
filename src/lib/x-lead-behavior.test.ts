import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in type-stripping test runner requires the explicit extension.
import { buildXLeadDiscoveryUpsertRow, type XLeadDiscoveryCandidate } from "./x-lead-discovery-upsert.ts";
// @ts-expect-error Node's built-in type-stripping test runner requires the explicit extension.
import { sortXLeadsByPriority, type XLeadRow } from "./x-lead.ts";

function candidate(overrides: Partial<XLeadDiscoveryCandidate> = {}): XLeadDiscoveryCandidate {
  return {
    postId: "post-1",
    authorHash: "a".repeat(64),
    handle: "pet_owner",
    postUrl: "https://x.com/pet_owner/status/1",
    mediaUrl: "https://example.com/pet.jpg",
    selectionStatus: "new",
    segment: "new_adoption",
    petType: "cat",
    likeCount: 1,
    replyCount: 0,
    repostCount: 0,
    viewCount: 10,
    followersCount: 20,
    targetingData: { ownership_terms: ["my cat"], matched_terms: ["just adopted"] },
    ...overrides,
  };
}

test("discovery refresh preserves an existing human decision and original discovery metadata", () => {
  const row = buildXLeadDiscoveryUpsertRow({
    candidate: candidate({ selectionStatus: "new" }),
    jobId: "new-job",
    discoveredAt: "2026-10-23T02:00:00Z",
    existing: {
      post_id: "post-1",
      selection_status: "contacted",
      source_job_id: "original-job",
      discovered_at: "2026-10-20T01:00:00Z",
      targeting_data: { manual_note: "sent" },
    },
  });

  assert.equal(row.selection_status, "contacted");
  assert.equal(row.source_job_id, "original-job");
  assert.equal(row.discovered_at, "2026-10-20T01:00:00Z");
  assert.deepEqual(row.targeting_data, { manual_note: "sent" });
});

function lead(id: string, selectionStatus: string, targetingData: Record<string, unknown>, discoveredAt: string) {
  return {
    id,
    selection_status: selectionStatus,
    targeting_data: targetingData,
    discovered_at: discoveredAt,
    pet_type: "cat",
    us_confidence: 90,
    us_evidence: "profile_location_country:US",
  } as XLeadRow;
}

test("candidate sorting puts recommended rows before manual review and contacted rows", () => {
  const rows = [
    lead("contacted", "contacted", {}, "2026-10-23T03:00:00Z"),
    lead("manual", "new", {}, "2026-10-23T02:00:00Z"),
    lead("recommended", "new", { ownership_terms: ["my cat"], matched_terms: ["just adopted"] }, "2026-10-23T01:00:00Z"),
  ];

  assert.deepEqual(sortXLeadsByPriority(rows).map((row) => row.id), ["recommended", "manual", "contacted"]);
});
