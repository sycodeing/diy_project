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

test("account cards now reserve only the fixed manual sender, never auto approval", () => {
  assert.equal(accountV2QueueEligibility(base).ready, true);
  const html = renderToStaticMarkup(createElement(AccountV2QueueControl, {
    authorId: "123456789", senders: [{ id: "old-other-account", label: "Latte192837465" }], hasPreview: true,
  }));
  assert.match(html, /name="authorId" value="123456789"/);
  assert.match(html, /648f2feb-3820-4306-8192-184444ef7cb8/);
  assert.match(html, /Le6wCummeratawi/);
  assert.match(html, /加入账号手动发送队列/);
  assert.doesNotMatch(html, /Latte192837465|加入自动队列|批准所选并启动|<select/);
});

test("active queues, expiring links and dismissed drafts remain blocked", () => {
  assert.equal(accountV2QueueEligibility({ ...base, hasActiveQueueJob: true }).ready, false);
  assert.match(accountV2QueueEligibility({ ...base, draft: { ...draft, marketing_expires_at: "2026-11-23T12:00:00Z" } }).reason, /24 小时/);
  assert.equal(accountV2QueueEligibility({ ...base, draft: { ...draft, marketing_expires_at: "invalid" } }).ready, false);
  assert.equal(accountV2QueueEligibility({ ...base, draft: { ...draft, review_status: "dismissed" } }).ready, false);
});

test("text-only manual reservation requires an explicit form declaration", () => {
  const html = renderToStaticMarkup(createElement(AccountV2QueueControl, { authorId: "123456789", senders: [], hasPreview: false }));
  assert.match(html, /required="" name="confirmTextOnly"/);
  assert.match(html, /我明确选择现有纯文字草稿/);
  assert.match(html, /不自动生成、打开 X 或发送/);
});
