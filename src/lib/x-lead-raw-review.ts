import { z } from "zod";

export const xLeadRawReviewSchema = z.object({
  postId: z.string().regex(/^\d{1,30}$/),
  authorId: z.string().max(100),
  handle: z.string().regex(/^[A-Za-z0-9_]{1,50}$/),
  postUrl: z.url().refine((value) => /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/.test(value)),
  postText: z.string().max(3000),
  postedAt: z.string().datetime({ offset: true }).nullable(),
  sourceArchive: z.string().max(200),
  sourceStage: z.string().max(80),
  classifierVersion: z.string().max(80),
  classifierTier: z.enum(["excluded", "exploratory", "explicit_request"]),
  exclusionReasons: z.array(z.string().max(80)).max(20),
  intent: z.record(z.string(), z.unknown()),
  bodyTopicMatch: z.boolean(),
  isReply: z.boolean(),
  parentPostId: z.string().max(100).nullable(),
  parentStatus: z.enum(["not_applicable", "unresolved", "resolved_product_mismatch"]),
  parentEvidence: z.string().max(3000).nullable().default(null),
  parentSourceArchive: z.string().max(200).nullable().default(null),
});

export type XLeadRawReviewInput = z.infer<typeof xLeadRawReviewSchema>;

export function toRawReviewRow(input: XLeadRawReviewInput, sourceJobId?: string) {
  return {
    post_id: input.postId,
    author_id: input.authorId,
    x_handle: input.handle,
    post_url: input.postUrl,
    post_text: input.postText,
    posted_at: input.postedAt,
    source_archive: input.sourceArchive,
    source_stage: input.sourceStage,
    ...(sourceJobId ? { source_job_id: sourceJobId } : {}),
    classifier_version: input.classifierVersion,
    classifier_tier: input.classifierTier,
    exclusion_reasons: input.exclusionReasons,
    intent: input.intent,
    body_topic_match: input.bodyTopicMatch,
    is_reply: input.isReply,
    parent_post_id: input.parentPostId,
    parent_status: input.parentStatus,
    parent_evidence: input.parentEvidence,
    parent_source_archive: input.parentSourceArchive,
    last_seen_at: new Date().toISOString(),
  };
}

export function keepResolvedParentEvidence<T extends {
  post_id: string; parent_status: string; parent_evidence: string | null;
  parent_source_archive: string | null;
}>(rows: T[], existing: Array<{ post_id: string; parent_status: string;
  parent_evidence: string | null; parent_source_archive: string | null }>): T[] {
  const resolved = new Map(existing.filter((row) => row.parent_status === "resolved_product_mismatch")
    .map((row) => [row.post_id, row]));
  return rows.map((row) => {
    const prior = resolved.get(row.post_id);
    return prior && row.parent_status === "unresolved"
      ? { ...row, parent_status: prior.parent_status,
          parent_evidence: prior.parent_evidence,
          parent_source_archive: prior.parent_source_archive }
      : row;
  });
}
