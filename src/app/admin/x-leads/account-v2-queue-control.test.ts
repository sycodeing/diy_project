import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountV2QueueControl } from "./account-v2-queue-control.tsx";
import { accountV2QueueEligibility } from "./account-v2-queue-eligibility.ts";

const nowMs = Date.parse("2026-11-23T00:00:00Z");
const account = { review_status: "unreviewed", account_status: "watch", entry_status: "ready", account_evidence: {} };
const draft = { status: "draft_ready", review_status: "unreviewed", marketing_expires_at: "2026-11-30T00:00:00Z",
  product_slug: "custom-pillow", selected_post_created_at: "2026-11-22T00:00:00Z",
  reply_text: "A conditional cover suggestion https://www.thebestdiyshop.com/g/abcdefghij",
  marketing_url: "https://www.thebestdiyshop.com/g/abcdefghij" };
const base = { draft, account, activeSlugs: new Set(["custom-pillow"]), hasActiveQueueJob: false, nowMs };

test("a live draft_ready account card renders sender choice and V2 add button", () => {
  assert.equal(accountV2QueueEligibility(base).ready, true);
  const html = renderToStaticMarkup(createElement(AccountV2QueueControl, {
    authorId: "123456789", senders: [{ id: "00000000-0000-0000-0000-000000000001", label: "发送账号 A" }],
  }));
  assert.match(html, /name="authorId" value="123456789"/);
  assert.match(html, /name="accountId" required=""/);
  assert.match(html, /发送账号 A/);
  assert.match(html, /加入自动队列 V2/);
  assert.match(html, /只加入待审队列/);
  assert.doesNotMatch(html, /批准所选并启动/);
});

test("active queue, expiring link and dismissed draft hide the add control", () => {
  assert.equal(accountV2QueueEligibility({ ...base, hasActiveQueueJob: true }).ready, false);
  assert.match(accountV2QueueEligibility({ ...base, draft: { ...draft, marketing_expires_at: "2026-11-23T12:00:00Z" } }).reason, /24 小时/);
  assert.equal(accountV2QueueEligibility({ ...base, draft: { ...draft, marketing_expires_at: "invalid" } }).ready, false);
  assert.equal(accountV2QueueEligibility({ ...base, draft: { ...draft, review_status: "dismissed" } }).ready, false);
  assert.match(accountV2QueueEligibility({ ...base, draft: null }).reason, /尚无草稿/);
});
