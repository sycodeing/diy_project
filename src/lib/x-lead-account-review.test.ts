import assert from "node:assert/strict";
import test from "node:test";
import { supportsAccountFirst } from "./x-lead-worker-version.ts";
import { accountCompletionIsIsolated, toAccountReviewRow, xLeadAccountReviewSchema } from "./x-lead-account-review.ts";

const candidate = {
  authorId: "123456789", xHandle: "cat_person", accountStatus: "potential",
  entryStatus: "no_entry", classifierVersion: "account-first-v1",
  accountEvidence: { person_evidence: [{ post_id: "11111", quote: "my cat" }],
    project_evidence: [{ post_id: "22222", quote: "I designed a tag" }],
    shopping_intent: "unknown", product_fit: "possible" },
  entryEvidence: { post_id: null, draft_ready: false, contact_permission: false },
  sourceArchive: "account-first-example", sourceHistory: [{ archive_id: "account-first-example" }],
};

test("account review contract is separate from strict lead and stable by author ID", () => {
  const parsed = xLeadAccountReviewSchema.parse(candidate);
  const row = toAccountReviewRow(parsed);
  assert.equal(row.author_id, "123456789");
  assert.equal(row.account_status, "potential");
  assert.equal(row.entry_status, "no_entry");
  assert.equal(row.account_evidence.shopping_intent, "unknown");
  assert.equal("review_status" in row, false); // DB default and atomic conflict RPC protect manual state.
  assert.equal(xLeadAccountReviewSchema.safeParse({ ...candidate, authorId: "@cat_person" }).success, false);
  assert.equal(xLeadAccountReviewSchema.safeParse({ ...candidate, accountStatus: "qualified" }).success, false);
});

test("worker 1.18 cannot claim account jobs; 1.19 can", () => {
  assert.equal(supportsAccountFirst(undefined), false);
  assert.equal(supportsAccountFirst("1.18.3"), false);
  assert.equal(supportsAccountFirst("1.19.0"), false);
  assert.equal(supportsAccountFirst("1.19.1"), false);
  assert.equal(supportsAccountFirst("1.19.2"), true);
});

test("completion mode keeps account reviews apart from strict and post raw pools", () => {
  assert.equal(accountCompletionIsIsolated("account_first", 0, 0, 1), true);
  assert.equal(accountCompletionIsIsolated("account_first", 1, 0, 1), false);
  assert.equal(accountCompletionIsIsolated("account_first", 0, 1, 1), false);
  assert.equal(accountCompletionIsIsolated("engagement_recall", 0, 1, 0), true);
  assert.equal(accountCompletionIsIsolated("engagement_recall", 0, 0, 1), false);
});
