import assert from "node:assert/strict";
import test from "node:test";
import { summarizeMarketing, type MarketingReportRow } from "./marketing-report.ts";

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
      { event_type: "link_generated", created_at: "2026-10-23T00:00:00.000Z", order_id: null, activity_session_id: null, is_internal: false },
      { event_type: "link_clicked", created_at: "2026-10-23T00:01:00.000Z", order_id: null, activity_session_id: null, is_internal: false },
      { event_type: "landing_confirmed", created_at: "2026-10-23T00:01:02.000Z", order_id: null, activity_session_id: "session-1", is_internal: false },
      { event_type: "preview_ready", created_at: "2026-10-23T00:01:05.000Z", order_id: null, activity_session_id: "session-2", is_internal: true },
    ],
    marketing_link_visits: [
      { id: "visit-1", visited_at: "2026-10-23T00:01:00.000Z", device_class: "desktop", referrer_group: "x", suspected_bot: false, is_internal: false, design_requested_at: "2026-10-23T00:01:01.000Z", browser_confirmed_at: "2026-10-23T00:01:02.000Z", first_interaction_at: "2026-10-23T00:01:04.000Z" },
      { id: "visit-2", visited_at: "2026-10-23T00:02:00.000Z", device_class: "desktop", referrer_group: "x", suspected_bot: true, is_internal: false, design_requested_at: null, browser_confirmed_at: null, first_interaction_at: null },
      { id: "visit-3", visited_at: "2026-10-23T00:03:00.000Z", device_class: "desktop", referrer_group: "internal", suspected_bot: false, is_internal: true, design_requested_at: "2026-10-23T00:03:01.000Z", browser_confirmed_at: "2026-10-23T00:03:02.000Z", first_interaction_at: null },
    ],
    orders: [],
  };

  const summary = summarizeMarketing([row]);
  assert.equal(summary.totalClicks, 4);
  assert.equal(summary.unflaggedRedirects, 1);
  assert.equal(summary.excludedRedirects, 2);
  assert.equal(summary.serverDesignRequests, 1);
  assert.equal(summary.visitBrowserConfirmations, 1);
  assert.equal(summary.visitInteractions, 1);
  assert.equal(summary.stageCounts.link_clicked, 1);
  assert.equal(summary.stageCounts.landing_confirmed, 1);
  assert.equal(summary.stageCounts.preview_ready, 0);
});

test("known-bot browser callbacks are not counted as qualified visits", () => {
  const visit = { id: "visit-bot", visited_at: "2026-10-23T00:01:00.000Z", device_class: "desktop", referrer_group: "direct", suspected_bot: true, is_internal: false, design_requested_at: "2026-10-23T00:01:01.000Z", browser_confirmed_at: "2026-10-23T00:01:02.000Z", first_interaction_at: "2026-10-23T00:01:03.000Z" };
  const summary = summarizeMarketing([{ id: "link-bot", campaign: "test", channel: "public_reply", variant: "a", source_hash: "a".repeat(64), click_count: 1, created_at: visit.visited_at, expires_at: "2026-10-30T00:00:00.000Z", marketing_events: [], marketing_link_visits: [visit], orders: [] }]);
  assert.equal(summary.serverDesignRequests, 1);
  assert.equal(summary.visitBrowserConfirmations, 0);
  assert.equal(summary.visitInteractions, 0);
});
