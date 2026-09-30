export const MARKETING_STAGES = [
  "link_generated",
  "link_clicked",
  "design_opened",
  "preview_ready",
  "checkout_started",
  "payment_completed",
] as const;

export type MarketingReportRow = {
  id: string;
  campaign: string;
  channel: string;
  variant: string;
  source_hash: string;
  click_count: number;
  created_at: string;
  expires_at: string;
  marketing_events: Array<{
    event_type: string;
    created_at: string;
    order_id: string | null;
  }>;
  orders: Array<{
    id: string;
    order_number: string;
    amount_cents: number;
    currency: string;
    payment_status: string;
    paid_at: string | null;
  }>;
};

export function summarizeMarketing(rows: MarketingReportRow[]) {
  const stageCounts = Object.fromEntries(
    MARKETING_STAGES.map((stage) => [
      stage,
      rows.filter((row) => row.marketing_events.some((event) => event.event_type === stage)).length,
    ]),
  ) as Record<(typeof MARKETING_STAGES)[number], number>;
  const paidOrders = rows.flatMap((row) => row.orders).filter((order) => order.payment_status === "paid");
  const revenue = paidOrders.reduce((sum, order) => sum + order.amount_cents, 0);
  return {
    stageCounts,
    paidOrders: paidOrders.length,
    revenue,
    averageOrderValue: paidOrders.length ? Math.round(revenue / paidOrders.length) : 0,
  };
}
