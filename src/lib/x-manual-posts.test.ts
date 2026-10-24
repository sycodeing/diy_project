import assert from "node:assert/strict";
import test from "node:test";
import { sortXManualPosts, type XManualPost } from "./x-reply.ts";

function post(id: string, status: XManualPost["status"], createdAt: string) {
  return { id, status, created_at: createdAt } as XManualPost;
}

test("keeps drafts first and moves sent or discarded rows to the bottom", () => {
  const original = [
    post("sent-new", "sent", "2026-10-21T04:00:00Z"),
    post("draft-old", "draft", "2026-10-21T01:00:00Z"),
    post("discarded", "discarded", "2026-10-21T05:00:00Z"),
    post("draft-new", "draft", "2026-10-21T03:00:00Z"),
  ];

  assert.deepEqual(sortXManualPosts(original).map((item) => item.id), [
    "draft-new",
    "draft-old",
    "sent-new",
    "discarded",
  ]);
  assert.deepEqual(original.map((item) => item.id), ["sent-new", "draft-old", "discarded", "draft-new"]);
});
