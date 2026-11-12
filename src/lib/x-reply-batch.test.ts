import assert from "node:assert/strict";
import test from "node:test";
import { summarizeLatestXReplyBatch } from "./x-reply.ts";

test("summarizes only the latest approved batch", () => {
  const summary = summarizeLatestXReplyBatch([
    { approved_at: "2026-11-07T01:00:00.000Z", completed_at: "2026-11-07T01:01:00.000Z", status: "sent", result_url: "https://x.com/test/status/1" },
    { approved_at: "2026-11-08T01:00:00.000Z", completed_at: "2026-11-08T01:01:00.000Z", status: "sent", result_url: "https://x.com/test/status/2" },
    { approved_at: "2026-11-08T01:00:00.000Z", completed_at: null, status: "queued", result_url: null },
    { approved_at: null, completed_at: null, status: "draft", result_url: null },
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
    { approved_at: "2026-11-08T02:00:00.000Z", completed_at: "2026-11-08T02:01:00.000Z", status: "sent", result_url: "https://x.com/test/status/3" },
    { approved_at: "2026-11-08T02:00:00.000Z", completed_at: "2026-11-08T02:03:00.000Z", status: "failed", result_url: null },
    { approved_at: "2026-11-08T02:00:00.000Z", completed_at: "2026-11-08T02:02:00.000Z", status: "uncertain", result_url: null },
  ]);

  assert.equal(summary?.state, "completed_with_issues");
  assert.equal(summary?.progress, 100);
  assert.equal(summary?.completedAt, "2026-11-08T02:03:00.000Z");
});

test("uncertain and sent without result URL do not count as confirmed sends", () => {
  const summary = summarizeLatestXReplyBatch([
    { approved_at: "2026-11-08T03:00:00.000Z", completed_at: "2026-11-08T03:01:00.000Z", status: "uncertain", result_url: null },
    { approved_at: "2026-11-08T03:00:00.000Z", completed_at: "2026-11-08T03:02:00.000Z", status: "sent", result_url: null },
  ]);
  assert.equal(summary?.sent, 0);
  assert.equal(summary?.uncertain, 2);
});
