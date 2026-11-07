import type { X_LEAD_DISCOVERY_SEGMENTS } from "@/lib/x-lead";

export const HUMAN_X_LEAD_STATUSES = new Set([
  "review",
  "approved",
  "rejected",
  "contacted",
  "suppressed",
]);

export type XLeadDiscoveryCandidate = {
  postId: string;
  authorHash: string;
  handle: string;
  postUrl: string;
  mediaUrl: string;
  mediaUrls?: string[];
  postedAt?: string | null;
  selectionStatus: "new" | "location_review" | "targeting_review" | "rejected_targeting";
  segment: (typeof X_LEAD_DISCOVERY_SEGMENTS)[number];
  petType: "cat" | "dog";
  occasion?: string | null;
  occasionConfidence?: number | null;
  ownershipConfidence?: number | null;
  usConfidence?: number | null;
  usEvidence?: string | null;
  leadScore?: number | null;
  likeCount: number;
  replyCount: number;
  repostCount: number;
  viewCount: number;
  followersCount: number;
  targetingData: Record<string, unknown>;
  consentCopy?: string | null;
  publicCopy?: string | null;
  directMessageCopy?: string | null;
};

export type ExistingXLeadDiscoveryRow = {
  post_id: string;
  author_hash?: string;
  selection_status: string;
  source_job_id: string | null;
  discovered_at: string;
  targeting_data: Record<string, unknown> | null;
  media_url?: string;
  media_urls?: string[] | null;
};

export function filterXLeadDiscoveryCandidates({
  candidates,
  existing,
  blacklistedAuthorHashes,
}: {
  candidates: XLeadDiscoveryCandidate[];
  existing: ExistingXLeadDiscoveryRow[];
  blacklistedAuthorHashes: Set<string>;
}) {
  const existingByPostId = new Map(existing.map((lead) => [lead.post_id, lead]));
  const existingAuthorHashes = new Set(existing.flatMap((lead) => lead.author_hash ? [lead.author_hash] : []));
  const chosenByAuthor = new Map<string, XLeadDiscoveryCandidate>();
  let blacklistedCandidates = 0;
  let duplicateAccountCandidates = 0;

  for (const candidate of candidates) {
    if (blacklistedAuthorHashes.has(candidate.authorHash)) {
      blacklistedCandidates += 1;
      continue;
    }
    const chosen = chosenByAuthor.get(candidate.authorHash);
    if (!chosen) {
      chosenByAuthor.set(candidate.authorHash, candidate);
      continue;
    }
    duplicateAccountCandidates += 1;
    if (existingByPostId.has(candidate.postId) && !existingByPostId.has(chosen.postId)) {
      chosenByAuthor.set(candidate.authorHash, candidate);
    }
  }

  const accepted = [...chosenByAuthor.values()].filter((candidate) => {
    if (!existingAuthorHashes.has(candidate.authorHash) || existingByPostId.has(candidate.postId)) return true;
    duplicateAccountCandidates += 1;
    return false;
  });
  return { accepted, blacklistedCandidates, duplicateAccountCandidates };
}

export function buildXLeadDiscoveryUpsertRow({
  candidate,
  jobId,
  discoveredAt,
  existing,
}: {
  candidate: XLeadDiscoveryCandidate;
  jobId: string;
  discoveredAt: string;
  existing?: ExistingXLeadDiscoveryRow;
}) {
  const preserveHumanDecision = Boolean(existing && HUMAN_X_LEAD_STATUSES.has(existing.selection_status));
  const candidateMediaUrls = uniqueMediaUrls(candidate.mediaUrls, candidate.mediaUrl);
  const mediaUrls = uniqueMediaUrls(existing?.media_urls, ...candidateMediaUrls);
  return {
    source_job_id: existing?.source_job_id ?? jobId,
    post_id: candidate.postId,
    author_hash: candidate.authorHash,
    x_handle: candidate.handle,
    post_url: candidate.postUrl,
    media_url: preserveHumanDecision && existing?.media_url ? existing.media_url : candidate.mediaUrl,
    media_urls: mediaUrls,
    posted_at: candidate.postedAt ?? null,
    discovered_at: existing?.discovered_at ?? discoveredAt,
    selection_status: preserveHumanDecision ? existing!.selection_status : candidate.selectionStatus,
    segment: candidate.segment,
    pet_type: candidate.petType,
    occasion: candidate.occasion ?? null,
    occasion_confidence: candidate.occasionConfidence ?? null,
    ownership_confidence: candidate.ownershipConfidence ?? null,
    us_confidence: candidate.usConfidence ?? null,
    us_evidence: candidate.usEvidence ?? null,
    lead_score: candidate.leadScore ?? null,
    like_count: candidate.likeCount,
    reply_count: candidate.replyCount,
    repost_count: candidate.repostCount,
    view_count: candidate.viewCount,
    followers_count: candidate.followersCount,
    targeting_data: preserveHumanDecision ? (existing!.targeting_data ?? candidate.targetingData) : candidate.targetingData,
    consent_copy: candidate.consentCopy ?? null,
    public_copy: candidate.publicCopy ?? null,
    direct_message_copy: candidate.directMessageCopy ?? null,
  };
}

function uniqueMediaUrls(values: string[] | null | undefined, fallback: string): string[];
function uniqueMediaUrls(values: string[] | null | undefined, ...fallback: string[]): string[];
function uniqueMediaUrls(values: string[] | null | undefined, ...fallback: string[]) {
  return [...new Set([...(values ?? []), ...fallback].filter((value) => value.startsWith("https://")))].slice(0, 4);
}
