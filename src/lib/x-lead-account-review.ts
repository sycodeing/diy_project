import { z } from "zod";

export const xLeadAccountReviewSchema = z.object({
  authorId: z.string().regex(/^\d{5,30}$/),
  xHandle: z.string().regex(/^[A-Za-z0-9_]{1,50}$/).nullable(),
  accountStatus: z.enum(["potential", "watch", "insufficient", "excluded"]),
  entryStatus: z.enum(["ready", "no_entry", "context_pending", "hold"]),
  accountEvidence: z.record(z.string(), z.unknown()),
  entryEvidence: z.record(z.string(), z.unknown()),
  sourceArchive: z.string().min(1).max(200),
  sourceHistory: z.array(z.record(z.string(), z.unknown())).max(20),
  classifierVersion: z.string().min(1).max(80),
});

export type XLeadAccountReview = z.infer<typeof xLeadAccountReviewSchema>;

export function toAccountReviewRow(value: XLeadAccountReview) {
  return {
    author_id: value.authorId,
    x_handle: value.xHandle,
    account_status: value.accountStatus,
    entry_status: value.entryStatus,
    account_evidence: value.accountEvidence,
    entry_evidence: value.entryEvidence,
    source_history: value.sourceHistory,
    latest_source_archive: value.sourceArchive,
    classifier_version: value.classifierVersion,
  };
}

export function accountCompletionIsIsolated(mode: unknown, strictCount: number, rawCount: number, accountCount: number) {
  return mode === "account_first"
    ? strictCount === 0 && rawCount === 0
    : accountCount === 0;
}
