import assert from "node:assert/strict";
import test from "node:test";
import {
  MARKETING_CHANNEL_LABELS,
  MARKETING_STAGE_LABELS,
  MARKETING_STAGES,
  summarizeMarketing,
  type MarketingReportRow,
} from "./marketing-report";

test("营销漏斗使用精简中文阶段并计算已付款订单", () => {
  const row = {
    id: "link-1",
    campaign: "first-customer",
    channel: "direct_message",
    variant: "v1",
    source_hash: "a".repeat(64),
    click_count: 1,
    created_at: "2026-10-11T00:00:00Z",
    expires_at: "2026-10-18T00:00:00Z",
    marketing_events: [
      { event_type: "link_generated", created_at: "2026-10-11T00:00:00Z", order_id: null },
      { event_type: "account_linked", created_at: "2026-10-11T00:01:00Z", order_id: null },
      { event_type: "payment_completed", created_at: "2026-10-11T00:02:00Z", order_id: "order-1" },
    ],
    orders: [{
      id: "order-1",
      order_number: "DIY-1",
      amount_cents: 1999,
      currency: "usd",
      payment_status: "paid",
      paid_at: "2026-10-11T00:02:00Z",
    }],
  } as MarketingReportRow;

  const summary = summarizeMarketing([row]);
  assert.equal(summary.stageCounts.account_linked, 1);
  assert.equal(summary.paidOrders, 1);
  assert.equal(summary.revenue, 1999);
  assert.equal(MARKETING_STAGE_LABELS.account_linked, "网站账号已创建");
  assert.equal(MARKETING_STAGE_LABELS.checkout_started, "已发起付款");
  assert.equal(MARKETING_STAGES.includes("preview_ready" as never), false);
  assert.equal(MARKETING_CHANNEL_LABELS.direct_message, "私信");
});
