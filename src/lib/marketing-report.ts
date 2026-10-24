export const MARKETING_STAGES = [
  "link_generated",
  "link_clicked",
  "design_opened",
  "preview_ready",
  "checkout_started",
  "payment_completed",
] as const;

export const MARKETING_STAGE_LABELS: Record<(typeof MARKETING_STAGES)[number], string> = {
  link_generated: "链接已生成",
  link_clicked: "收到跳转请求",
  design_opened: "已打开设计器",
  preview_ready: "预览已生成",
  checkout_started: "已开始结账",
  payment_completed: "支付已完成",
};

export const MARKETING_CHANNEL_LABELS: Record<string, string> = {
  consent_reply: "同意后回复",
  public_reply: "公开回复",
  direct_message: "私信",
};

export function marketingStageLabel(stage: string) {
  return MARKETING_STAGE_LABELS[stage as keyof typeof MARKETING_STAGE_LABELS] ?? stage;
}

export function marketingChannelLabel(channel: string) {
  return MARKETING_CHANNEL_LABELS[channel] ?? channel;
}

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
  marketing_link_visits: Array<{
    id: string;
    visited_at: string;
    device_class: string;
    referrer_group: string;
    suspected_bot: boolean;
    is_internal: boolean;
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
    totalClicks: rows.reduce((sum, row) => sum + row.click_count, 0),
    qualifiedRedirects: rows.flatMap((row) => row.marketing_link_visits).filter((visit) => !visit.suspected_bot && !visit.is_internal).length,
    excludedRedirects: rows.flatMap((row) => row.marketing_link_visits).filter((visit) => visit.suspected_bot || visit.is_internal).length,
    paidOrders: paidOrders.length,
    revenue,
    averageOrderValue: paidOrders.length ? Math.round(revenue / paidOrders.length) : 0,
  };
}
