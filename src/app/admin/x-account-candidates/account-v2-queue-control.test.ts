import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountV2QueueControl } from "./account-v2-queue-control.tsx";
import { accountV2QueueEligibility } from "./account-v2-queue-eligibility.ts";
import { selectAccountDesign } from "@/lib/x-account-design-selector";

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

test("the screenshot's undecided living room defaults to an available neutral preview", () => {
  const design = selectAccountDesign({
    status: "draft_ready", reason: "conditional room suggestion", evidenceCoverage: "full",
    selectedPost: { post_id: "2122355837188583670", created_at: "2026-11-16T15:47:17Z",
      text: "picking a color to paint our living room might be my most difficult task", source: "recent" },
    productSlug: "custom-pillow", productMatchReason: "conditional decor", conversationAngle: null, matchStrength: 1,
  });
  assert.equal(design.kind, "procedural");
  if (design.kind !== "procedural") return;
  assert.equal(design.matchType, "fallback_option");
  const html = renderToStaticMarkup(createElement(AccountV2QueueControl, {
    authorId: "123456789", senders: [{ id: "sender-a", label: "发送账号 A" }], automaticPreviewFallback: true,
  }));
  assert.match(html, /未提供明确颜色或主题，将生成本店中性条纹方案供参考/);
  assert.match(html, /option value="auto_preview" selected=""/);
  assert.doesNotMatch(html, /button type="submit" disabled=""/);
  assert.match(html, /option value="text_only"/);
});

test("an explicit unsupported palette still blocks automatic preview and permits explicit text mode", () => {
  const design = selectAccountDesign({
    status: "draft_ready", reason: "conditional room suggestion", evidenceCoverage: "full",
    selectedPost: { post_id: "2122355837188583670", created_at: "2026-11-16T15:47:17Z",
      text: "I'm choosing a blue theme for our living room.", source: "recent" },
    productSlug: "custom-pillow", productMatchReason: "conditional decor", conversationAngle: null, matchStrength: 1,
  });
  assert.equal(design.kind, "no_design_match");
  if (design.kind !== "no_design_match") return;
  const html = renderToStaticMarkup(createElement(AccountV2QueueControl, {
    authorId: "123456789", senders: [{ id: "sender-a", label: "发送账号 A" }],
    automaticPreviewBlockReason: design.reason,
  }));
  assert.match(html, /暂无可自动生成的图文设计/);
  assert.match(html, /本人已提供颜色或主题，但当前暂无对应原创设计/);
  assert.match(html, /option value="auto_preview" disabled=""/);
  assert.match(html, /option value="" disabled="" selected=""/);
  assert.match(html, /button type="submit" disabled=""/);
  assert.match(html, /option value="text_only"/);
  assert.match(html, /option value="sender-a" selected=""/);
});

test("an available preview defaults to image mode, while no senders disable queue submission", () => {
  const html = renderToStaticMarkup(createElement(AccountV2QueueControl, { authorId: "123456789", senders: [] }));
  assert.match(html, /option value="auto_preview" selected=""/);
  assert.match(html, /button type="submit" disabled=""/);
  assert.match(html, /没有启用的发送账号/);
});
