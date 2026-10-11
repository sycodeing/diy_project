export const MARKETING_STAGES = [
  "link_generated",
  "link_clicked",
  "design_opened",
  "preview_ready",
  "account_linked",
  "checkout_started",
  "payment_completed",
] as const;

export const MARKETING_STAGE_LABELS: Record<(typeof MARKETING_STAGES)[number], string> = {
  link_generated: "链接已生成",
  link_clicked: "链接已点击",
  design_opened: "设计页已打开",
  preview_ready: "预览图已就绪",
  account_linked: "账号已关联",
  checkout_started: "已发起结账",
  payment_completed: "付款已完成",
};

export const MARKETING_CHANNEL_LABELS: Record<string, string> = {
  consent_reply: "征得同意后回复",
  public_reply: "公开回复",
  direct_message: "私信",
};

export type MarketingReportRow = {
  id: string;
  idempotency_key: string;
  campaign: string;
  channel: string;
  variant: string;
  source_hash: string;
  source_lead_id: string | null;
  x_handle: string | null;
  x_post_id: string | null;
  x_post_url: string | null;
  targeting_segment: string | null;
  lead_score: number | null;
  account_user_id: string | null;
  account_linked_at: string | null;
  account_was_created: boolean | null;
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
