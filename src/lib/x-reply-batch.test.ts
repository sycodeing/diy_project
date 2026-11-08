import assert from "node:assert/strict";
import test from "node:test";
import { summarizeLatestXReplyBatch } from "./x-reply.ts";

test("summarizes only the latest approved batch", () => {
  const summary = summarizeLatestXReplyBatch([
    { approved_at: "2026-11-07T01:00:00.000Z", completed_at: "2026-11-07T01:01:00.000Z", status: "sent" },
    { approved_at: "2026-11-08T01:00:00.000Z", completed_at: "2026-11-08T01:01:00.000Z", status: "sent" },
    { approved_at: "2026-11-08T01:00:00.000Z", completed_at: null, status: "queued" },
    { approved_at: null, completed_at: null, status: "draft" },
  ]);

  assert.deepEqual(summary, {
    approvedAt: "2026-11-08T01:00:00.000Z",
    completedAt: null,
    total: 2,
    sent: 1,
    failed: 0,
    uncertain: 0,
    active: 1,
    completed: 1,
    progress: 50,
    state: "running",
  });
});

test("marks a fully processed batch with failures as completed with issues", () => {
  const summary = summarizeLatestXReplyBatch([
    { approved_at: "2026-11-08T02:00:00.000Z", completed_at: "2026-11-08T02:01:00.000Z", status: "sent" },
    { approved_at: "2026-11-08T02:00:00.000Z", completed_at: "2026-11-08T02:03:00.000Z", status: "failed" },
    { approved_at: "2026-11-08T02:00:00.000Z", completed_at: "2026-11-08T02:02:00.000Z", status: "uncertain" },
  ]);

  assert.equal(summary?.state, "completed_with_issues");
  assert.equal(summary?.progress, 100);
  assert.equal(summary?.completedAt, "2026-11-08T02:03:00.000Z");
});
