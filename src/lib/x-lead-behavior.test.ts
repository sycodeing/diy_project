import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in type-stripping test runner requires the explicit extension.
import { buildXLeadDiscoveryUpsertRow, filterXLeadDiscoveryCandidates, type XLeadDiscoveryCandidate } from "./x-lead-discovery-upsert.ts";
// @ts-expect-error Node's built-in type-stripping test runner requires the explicit extension.
import { filterXLeadsForQueue, getXLeadPriorityScore, getXLeadRejectionNote, getXLeadRejectionReason, sortXLeadsByPriority, type XLeadRow } from "./x-lead.ts";

function candidate(overrides: Partial<XLeadDiscoveryCandidate> = {}): XLeadDiscoveryCandidate {
  return {
    postId: "post-1",
    authorHash: "a".repeat(64),
    handle: "pet_owner",
    postUrl: "https://x.com/pet_owner/status/1",
    mediaUrl: "https://example.com/pet.jpg",
    mediaUrls: ["https://example.com/pet.jpg"],
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
      media_url: "https://example.com/chosen.jpg",
      media_urls: ["https://example.com/pet.jpg", "https://example.com/chosen.jpg"],
    },
  });

  assert.equal(row.selection_status, "contacted");
  assert.equal(row.source_job_id, "original-job");
  assert.equal(row.discovered_at, "2026-10-20T01:00:00Z");
  assert.deepEqual(row.targeting_data, { manual_note: "sent" });
  assert.equal(row.media_url, "https://example.com/chosen.jpg");
  assert.deepEqual(row.media_urls, ["https://example.com/pet.jpg", "https://example.com/chosen.jpg"]);
});

test("discovery excludes blacklisted accounts and keeps only one post per account", () => {
  const duplicateAuthor = "b".repeat(64);
  const blacklistedAuthor = "c".repeat(64);
  const result = filterXLeadDiscoveryCandidates({
    candidates: [
      candidate({ postId: "new-1", authorHash: duplicateAuthor }),
      candidate({ postId: "existing-1", authorHash: duplicateAuthor }),
      candidate({ postId: "blocked-1", authorHash: blacklistedAuthor }),
    ],
    existing: [{
      post_id: "existing-1",
      author_hash: duplicateAuthor,
      selection_status: "review",
      source_job_id: "job-1",
      discovered_at: "2026-10-20T01:00:00Z",
      targeting_data: {},
    }],
    blacklistedAuthorHashes: new Set([blacklistedAuthor]),
  });

  assert.deepEqual(result.accepted.map((item) => item.postId), ["existing-1"]);
  assert.equal(result.blacklistedCandidates, 1);
  assert.equal(result.duplicateAccountCandidates, 1);
});

test("blacklist excludes both an existing account post and every future post from that account", () => {
  const authorHash = "d".repeat(64);
  const existing = [{
    post_id: "existing-post",
    author_hash: authorHash,
    selection_status: "suppressed",
    source_job_id: "job-1",
    discovered_at: "2026-10-20T01:00:00Z",
    targeting_data: {},
  }];
  const blacklistedAuthorHashes = new Set([authorHash]);

  const existingResult = filterXLeadDiscoveryCandidates({
    candidates: [candidate({ postId: "existing-post", authorHash })],
    existing,
    blacklistedAuthorHashes,
  });
  const futureResult = filterXLeadDiscoveryCandidates({
    candidates: [candidate({ postId: "future-post", authorHash })],
    existing,
    blacklistedAuthorHashes,
  });

  assert.equal(existingResult.accepted.length, 0);
  assert.equal(existingResult.blacklistedCandidates, 1);
  assert.equal(futureResult.accepted.length, 0);
  assert.equal(futureResult.blacklistedCandidates, 1);
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

test("candidate sorting uses lead score before discovery time within the same conclusion", () => {
  const lowScore = { ...lead("low", "new", { ownership_terms: ["my cat"], matched_terms: ["just adopted"] }, "2026-10-23T03:00:00Z"), lead_score: 10 };
  const highScore = { ...lead("high", "new", { ownership_terms: ["my cat"], matched_terms: ["just adopted"] }, "2026-10-23T01:00:00Z"), lead_score: 90 };

  assert.deepEqual(sortXLeadsByPriority([lowScore, highScore]).map((row) => row.id), ["high", "low"]);
});

test("candidate sorting falls back to targeting quality when vision score is absent", () => {
  const stale = { ...lead("stale", "new", { ownership_terms: ["my cat"], matched_terms: ["just adopted"], engagement_quality: 20, account_quality: 40, recency_score: 10 }, "2026-10-23T03:00:00Z"), ownership_confidence: 88, occasion_confidence: 88 };
  const strong = { ...lead("strong", "new", { ownership_terms: ["my cat"], matched_terms: ["just adopted"], engagement_quality: 80, account_quality: 80, recency_score: 90 }, "2026-10-23T01:00:00Z"), ownership_confidence: 88, occasion_confidence: 88 };

  assert.ok(getXLeadPriorityScore(strong) > getXLeadPriorityScore(stale));
  assert.deepEqual(sortXLeadsByPriority([stale, strong]).map((row) => row.id), ["strong", "stale"]);
});

test("default candidate queue contains only actionable conclusions", () => {
  const recommended = lead("recommended", "new", { ownership_terms: ["my cat"], matched_terms: ["just adopted"] }, "2026-10-23T01:00:00Z");
  const manual = lead("manual", "new", {}, "2026-10-23T02:00:00Z");
  const excluded = lead("excluded", "rejected_targeting", { organization: true }, "2026-10-23T03:00:00Z");
  const contacted = lead("contacted", "contacted", {}, "2026-10-23T04:00:00Z");

  assert.deepEqual(filterXLeadsForQueue([excluded, contacted, manual, recommended], undefined).map((row) => row.id), ["manual", "recommended"]);
  assert.equal(filterXLeadsForQueue([excluded, contacted, manual, recommended], "all").length, 4);
  assert.deepEqual(filterXLeadsForQueue([excluded, contacted, manual, recommended], "excluded").map((row) => row.id), ["excluded"]);
});

test("manual rejection metadata has a safe legacy fallback", () => {
  const classified = lead("classified", "rejected", {
    manual_rejection_reason: "image_unusable",
    manual_rejection_note: "Pet is mostly obscured.",
  }, "2026-10-23T01:00:00Z");
  const legacy = lead("legacy", "rejected", {}, "2026-10-23T01:00:00Z");

  assert.equal(getXLeadRejectionReason(classified), "image_unusable");
  assert.equal(getXLeadRejectionNote(classified), "Pet is mostly obscured.");
  assert.equal(getXLeadRejectionReason(legacy), "legacy");
});
