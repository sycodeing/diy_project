import { z } from "zod";

export const X_LEAD_SEGMENTS = ["new_adoption", "pet_birthday"] as const;
export const X_SEARCH_PRODUCTS = ["Latest", "Top", "Media"] as const;
export const X_SEARCH_INTERVALS = [60, 180, 360, 720, 1440] as const;

export const X_LEAD_SEGMENT_LABELS: Record<string, string> = {
  new_adoption: "新领养 / 到家纪念",
  pet_birthday: "宠物生日",
  custom: "自定义",
};

export const X_SEARCH_PRODUCT_LABELS: Record<string, string> = {
  Latest: "最新帖子",
  Top: "热门帖子",
  Media: "图片帖子",
};

export const X_SEARCH_INTERVAL_LABELS: Record<number, string> = {
  60: "每小时",
  180: "每 3 小时",
  360: "每 6 小时",
  720: "每 12 小时",
  1440: "每天",
};

export const X_JOB_STATUS_LABELS: Record<string, string> = {
  queued: "等待本机执行",
  running: "正在筛选",
  completed: "已完成",
  failed: "执行失败",
  blocked: "X 访问受阻",
};

export const X_LEAD_STATUS_LABELS: Record<string, string> = {
  new: "待查看图片",
  location_review: "待确认美国地区",
  targeting_review: "待确认用户意图",
  rejected_targeting: "筛选条件不符",
  review: "待人工审核",
  approved: "已通过",
  rejected: "已拒绝",
  contacted: "已联系",
  suppressed: "不再联系",
};

export const searchConfigurationSchema = z.object({
  segments: z.array(z.enum(X_LEAD_SEGMENTS)).min(1).max(2),
  searchProduct: z.enum(X_SEARCH_PRODUCTS),
  resultLimit: z.number().int().min(1).max(100),
  lookbackDays: z.number().int().min(1).max(90),
  usRequired: z.boolean(),
  usMinConfidence: z.number().int().min(0).max(100),
  intervalMinutes: z.union([
    z.literal(60),
    z.literal(180),
    z.literal(360),
    z.literal(720),
    z.literal(1440),
  ]),
});

export type XSearchConfiguration = z.infer<typeof searchConfigurationSchema>;

export type XLeadRow = {
  id: string;
  post_id: string;
  x_handle: string;
  post_url: string;
  media_url: string;
  posted_at: string | null;
  discovered_at: string;
  selection_status: string;
  segment: string;
  occasion: string | null;
  occasion_confidence: number | null;
  ownership_confidence: number | null;
  us_confidence: number | null;
  us_evidence: string | null;
  lead_score: number | null;
  like_count: number;
  reply_count: number;
  repost_count: number;
  view_count: number;
  followers_count: number;
  consent_copy: string | null;
  public_copy: string | null;
  direct_message_copy: string | null;
  marketing_link_id: string | null;
  marketing_links: null | {
    id: string;
    idempotency_key: string;
    source_hash: string;
    expires_at: string;
    account_user_id: string | null;
    account_was_created: boolean | null;
    marketing_events: Array<{ event_type: string; created_at: string }>;
    orders: Array<{ id: string; payment_status: string; paid_at: string | null }>;
  };
};

export function createXLeadDrafts(segment: string, link = "{link}") {
  const opening = segment === "new_adoption"
    ? "Congratulations on welcoming your new pet home!"
    : segment === "pet_birthday"
      ? "Happy birthday to your lovely pet!"
      : "Your pet photo is wonderful!";

  return {
    consentCopy: `${opening} Would you be comfortable if I made a private personalized pillow preview from this photo? No reposting or purchase required.`,
    publicCopy: `${opening} I made a private personalized pillow preview from the photo. You can view or replace the image here: ${link}`,
    directMessageCopy: `Hi! ${opening} I made a private personalized pillow preview for you. You can view or replace the image here: ${link}. No pressure at all—reply stop and I will not contact you again.`,
  };
}

export function getXLeadFunnelStatus(lead: XLeadRow) {
  const link = lead.marketing_links;
  if (!link) return "尚未生成专属链接";

  const events = new Set(link.marketing_events.map((event) => event.event_type));
  if (events.has("payment_completed") || link.orders.some((order) => order.payment_status === "paid")) {
    return "付款已完成";
  }
  if (events.has("checkout_started")) return "已发起付款";
  if (events.has("account_linked") || link.account_user_id) return "网站账号已创建";
  if (events.has("design_opened")) return "设计页已打开";
  if (events.has("link_clicked")) return "链接已点击";
  return "链接已生成";
}

