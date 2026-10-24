import assert from "node:assert/strict";
import test from "node:test";
import { summarizeMarketing, type MarketingReportRow } from "./marketing-report";

test("keeps redirect requests separate from unflagged requests", () => {
  const row: MarketingReportRow = {
    id: "link-1",
    campaign: "test",
    channel: "public_reply",
    variant: "a",
    source_hash: "a".repeat(64),
    click_count: 4,
    created_at: "2026-10-23T00:00:00.000Z",
    expires_at: "2026-10-30T00:00:00.000Z",
    marketing_events: [
      { event_type: "link_generated", created_at: "2026-10-23T00:00:00.000Z", order_id: null },
      { event_type: "link_clicked", created_at: "2026-10-23T00:01:00.000Z", order_id: null },
    ],
    marketing_link_visits: [
      { id: "visit-1", visited_at: "2026-10-23T00:01:00.000Z", device_class: "desktop", referrer_group: "x", suspected_bot: false, is_internal: false },
      { id: "visit-2", visited_at: "2026-10-23T00:02:00.000Z", device_class: "desktop", referrer_group: "x", suspected_bot: true, is_internal: false },
      { id: "visit-3", visited_at: "2026-10-23T00:03:00.000Z", device_class: "desktop", referrer_group: "internal", suspected_bot: false, is_internal: true },
    ],
    orders: [],
  };

  const summary = summarizeMarketing([row]);
  assert.equal(summary.totalClicks, 4);
  assert.equal(summary.qualifiedRedirects, 1);
  assert.equal(summary.excludedRedirects, 2);
  assert.equal(summary.stageCounts.link_clicked, 1);
});
