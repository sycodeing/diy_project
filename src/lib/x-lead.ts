import { z } from "zod";

export const X_LEAD_SEGMENTS = [
  "new_adoption",
  "pet_birthday",
  "pet_adventure",
  "pet_costume",
  "pet_portrait",
] as const;
export const X_LEAD_DISCOVERY_SEGMENTS = [...X_LEAD_SEGMENTS, "custom"] as const;
export const X_SEARCH_PRODUCTS = ["Latest", "Top", "Media"] as const;
export const X_SEARCH_INTERVALS = [60, 180, 360, 720, 1440] as const;

export const X_LEAD_SEGMENT_LABELS: Record<string, string> = {
  new_adoption: "新领养 / 到家纪念",
  pet_birthday: "宠物生日",
  pet_adventure: "户外 / 旅行",
  pet_costume: "装扮 / 节日造型",
  pet_portrait: "照片 / 高光时刻",
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
  new: "硬性条件已通过，待人工审核",
  location_review: "待确认美国地区",
  targeting_review: "待人工确认文本证据",
  rejected_targeting: "筛选条件不符",
  review: "图片已确认，可进入发送准备",
  approved: "已通过",
  rejected: "已拒绝",
  contacted: "已联系",
  suppressed: "不再联系",
};

export const X_LEAD_CONCLUSION_LABELS = {
  recommended: "建议优先处理",
  manual_review: "建议人工判断",
  location_pending: "地点待核（不可入队）",
  excluded: "不建议处理",
  contacted: "已进入发送流程",
  do_not_contact: "不再联系",
} as const;

export const X_LEAD_REJECTION_REASONS = [
  "not_target_occasion",
  "not_pet_owner",
  "organization_or_ad",
  "location_mismatch",
  "image_unusable",
  "duplicate_or_contacted",
  "sensitive_or_inappropriate",
  "other",
] as const;

export const X_LEAD_REJECTION_REASON_LABELS: Record<string, string> = {
  not_target_occasion: "不是目标宠物场景",
  not_pet_owner: "无法确认是本人宠物",
  organization_or_ad: "机构、商家或广告内容",
  location_mismatch: "非美国或位置证据不足",
  image_unusable: "图片不适合制作产品",
  duplicate_or_contacted: "重复候选或已经联系",
  sensitive_or_inappropriate: "敏感、不适合营销的内容",
  other: "其他原因",
  legacy: "历史记录（未分类）",
};

export type XLeadRejectionReason = typeof X_LEAD_REJECTION_REASONS[number];

export function getXLeadRejectionReason(lead: Pick<XLeadRow, "targeting_data">) {
  const reason = lead.targeting_data?.manual_rejection_reason;
  return typeof reason === "string" && reason in X_LEAD_REJECTION_REASON_LABELS ? reason : "legacy";
}

export function getXLeadRejectionNote(lead: Pick<XLeadRow, "targeting_data">) {
  const note = lead.targeting_data?.manual_rejection_note;
  return typeof note === "string" ? note : "";
}

export type XLeadConclusion = keyof typeof X_LEAD_CONCLUSION_LABELS;

export type XLeadTargetingCheck = {
  key: "pet" | "us" | "account";
  label: string;
  standard: string;
  actual: string;
  passed: boolean;
  detail?: string;
};

type XLeadTargetingSnapshot = Pick<
  XLeadRow,
  "pet_type" | "us_confidence" | "us_evidence" | "targeting_data"
>;

export function getXLeadTargetingChecks(
  lead: XLeadTargetingSnapshot,
  usMinConfidence = 70,
): XLeadTargetingCheck[] {
  const organization = isTruthyFlag(lead.targeting_data?.organization);
  const advertisement = isTruthyFlag(lead.targeting_data?.advertisement);
  const accountActual = organization
    ? "机构、救助站或商业账号"
    : advertisement
      ? "帖子带广告或促销特征"
      : "未发现机构或广告特征";
  return [
    {
      key: "pet",
      label: "宠物类型",
      standard: "必须明确为猫或狗",
      actual: lead.pet_type === "cat" ? "猫" : lead.pet_type === "dog" ? "狗" : "未确认",
      passed: lead.pet_type === "cat" || lead.pet_type === "dog",
    },
    {
      key: "us",
      label: "美国位置",
      standard: `可信度至少 ${usMinConfidence} 分`,
      actual: `${lead.us_confidence ?? 0} 分`,
      passed: (lead.us_confidence ?? 0) >= usMinConfidence,
      detail: describeUsEvidence(lead.us_evidence),
    },
    {
      key: "account",
      label: "账号性质",
      standard: "个人宠物账号，不能是机构或广告",
      actual: accountActual,
      passed: !organization && !advertisement,
    },
  ];
}
export type XLeadReviewEvidence = {
  key: "ownership" | "occasion";
  label: string;
  evidence: string[];
  emptyText: string;
};

const OCCASION_EVIDENCE_TERMS = [
  "gotcha day", "adoption anniversary", "adopted today", "we adopted", "i adopted",
  "just adopted", "welcome home", "foster fail", "new family member", "meet our", "meet my",
  "happy birthday", "birthday boy", "birthday girl", "barkday", "birthday pup",
  "birthday kitty", "turns one", "turned one", "first birthday", "1st birthday",
  "hiking with my", "hiking with our", "beach day with my", "beach day with our",
  "road trip with my", "road trip with our", "camping with my", "camping with our",
  "adventure with my", "adventure with our", "in costume", "dressed up",
  "halloween costume", "holiday outfit", "christmas outfit", "favorite photo of my",
  "favorite photo of our", "best photo of my", "best photo of our", "my handsome",
  "our handsome", "my beautiful", "our beautiful", "my photogenic", "our photogenic",
  "look at my", "look at our",
];

const OWNERSHIP_EVIDENCE_PATTERNS = [
  /\b(?:my|our)\s+(?:dog|cat|puppy|kitten|pup|kitty|pet)\b/gi,
  /\b(?:we|i)\s+(?:just\s+)?adopted\b/gi,
  /\bmeet\s+(?:my|our)\b/gi,
  /\bwelcome\s+home\b/gi,
];

export function getXLeadReviewEvidence(lead: Pick<XLeadRow, "targeting_data">): XLeadReviewEvidence[] {
  const postText = getStoredPostText(lead.targeting_data);
  const storedOwnership = getStringArray(lead.targeting_data?.ownership_terms);
  const storedOccasion = getStringArray(lead.targeting_data?.matched_terms);
  const ownershipEvidence = storedOwnership.length ? storedOwnership : matchPatterns(postText, OWNERSHIP_EVIDENCE_PATTERNS);
  const occasionEvidence = storedOccasion.length
    ? storedOccasion
    : OCCASION_EVIDENCE_TERMS.filter((term) => postText.toLocaleLowerCase().includes(term));
  return [
    {
      key: "ownership",
      label: "本人宠物关系证据",
      evidence: ownershipEvidence,
      emptyText: "未提取到明确的本人宠物关系表达，请打开原帖人工确认。",
    },
    {
      key: "occasion",
      label: "宠物场景证据",
      evidence: occasionEvidence,
      emptyText: "未提取到明确的目标宠物场景，请打开原帖人工确认。",
    },
  ];
}

export function getXLeadReferenceConclusion(
  lead: XLeadTargetingSnapshot & Pick<XLeadRow, "selection_status">,
  usMinConfidence = 70,
): XLeadConclusion {
  if (lead.selection_status === "suppressed") return "do_not_contact";
  if (["approved", "contacted"].includes(lead.selection_status)) return "contacted";
  if (["rejected", "rejected_targeting"].includes(lead.selection_status)) return "excluded";
  const failedChecks = getXLeadTargetingChecks(lead, usMinConfidence).filter((check) => !check.passed);
  if (lead.selection_status === "location_review" && failedChecks.length === 1 && failedChecks[0].key === "us") return "location_pending";
  if (failedChecks.length) return "excluded";
  const evidence = getXLeadReviewEvidence(lead);
  return evidence.every((item) => item.evidence.length > 0) ? "recommended" : "manual_review";
}

const X_LEAD_CONCLUSION_ORDER: Record<XLeadConclusion, number> = {
  recommended: 0,
  manual_review: 1,
  location_pending: 2,
  excluded: 3,
  contacted: 4,
  do_not_contact: 5,
};

export function sortXLeadsByPriority(leads: XLeadRow[], usMinConfidence = 70) {
  return leads.toSorted((left, right) => {
    const conclusionDifference = X_LEAD_CONCLUSION_ORDER[getXLeadReferenceConclusion(left, usMinConfidence)]
      - X_LEAD_CONCLUSION_ORDER[getXLeadReferenceConclusion(right, usMinConfidence)];
    if (conclusionDifference) return conclusionDifference;
    const scoreDifference = getXLeadPriorityScore(right) - getXLeadPriorityScore(left);
    if (scoreDifference) return scoreDifference;
    return right.discovered_at.localeCompare(left.discovered_at) || right.id.localeCompare(left.id);
  });
}

export function getXLeadPriorityScore(lead: XLeadRow) {
  if (lead.lead_score !== null && lead.lead_score !== undefined) return lead.lead_score;
  const engagement = numericTargetingValue(lead.targeting_data?.engagement_quality, 0);
  const account = numericTargetingValue(lead.targeting_data?.account_quality, 0);
  const recency = numericTargetingValue(lead.targeting_data?.recency_score, 0);
  return Math.round(
    numericTargetingValue(lead.ownership_confidence, 0) * 0.25
      + numericTargetingValue(lead.occasion_confidence, 0) * 0.2
      + numericTargetingValue(lead.us_confidence, 0) * 0.2
      + engagement * 0.15
      + account * 0.1
      + recency * 0.1,
  );
}

function numericTargetingValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : fallback;
}

export function filterXLeadsForQueue(
  leads: XLeadRow[],
  conclusion: string | undefined,
  usMinConfidence = 70,
) {
  if (conclusion === "all") return leads;
  if (conclusion && conclusion in X_LEAD_CONCLUSION_LABELS) {
    return leads.filter((lead) => getXLeadReferenceConclusion(lead, usMinConfidence) === conclusion);
  }
  return leads.filter((lead) => {
    const referenceConclusion = getXLeadReferenceConclusion(lead, usMinConfidence);
    return referenceConclusion === "recommended" || referenceConclusion === "manual_review" || referenceConclusion === "location_pending";
  });
}

function getStoredPostText(targetingData: XLeadRow["targeting_data"]) {
  if (typeof targetingData?.post_excerpt === "string") return targetingData.post_excerpt;
  const source = targetingData?.source;
  if (source && typeof source === "object" && "post_text" in source && typeof source.post_text === "string") {
    return source.post_text;
  }
  return "";
}

function getStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function matchPatterns(text: string, patterns: RegExp[]) {
  const matches = patterns.flatMap((pattern) => Array.from(text.matchAll(pattern), (match) => match[0]));
  return [...new Map(matches.map((match) => [match.toLocaleLowerCase(), match])).values()];
}

export function describeUsEvidence(evidence: string | null) {
  if (!evidence || evidence === "no_public_location") return "没有可验证的公开位置证据";
  if (evidence === "account_based_in:US") return "X 公开账号来源显示为美国";
  if (evidence === "profile_and_account_based_in:US") return "主页位置与 X 账号来源均指向美国";
  if (evidence === "search_query_place_country:US") return "帖子命中 X 的美国地理位置条件";
  if (evidence === "post_place_country:US") return "帖子公开地点显示为美国";
  if (evidence === "profile_location_country:US") return "主页公开位置写明美国";
  if (evidence === "profile_location_state") return "主页公开位置命中美国州名";
  if (evidence.startsWith("profile_location_state:")) return `主页公开位置命中美国州代码 ${evidence.split(":")[1]}`;
  if (evidence === "profile_location_us_city") return "主页公开位置命中已知美国城市";
  if (evidence.startsWith("account_based_in_non_us:")) return `X 公开账号来源显示为 ${evidence.split(":").slice(1).join(":")}`;
  if (evidence.startsWith("post_place_country:")) return `帖子公开地点不是美国：${evidence.split(":").slice(1).join(":")}`;
  if (evidence.startsWith("location_conflict:")) return "主页位置与 X 账号来源冲突，需要人工确认";
  if (evidence === "profile_location_non_us") return "主页公开位置明确指向非美国地区";
  if (evidence === "profile_location_unresolved") return "主页位置存在，但无法确认是否属于美国";
  return evidence;
}

function isTruthyFlag(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

export const searchConfigurationSchema = z.object({
  segments: z.array(z.enum(X_LEAD_SEGMENTS)).min(1).max(X_LEAD_SEGMENTS.length),
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
  media_urls: string[] | null;
  posted_at: string | null;
  discovered_at: string;
  selection_status: string;
  segment: string;
  pet_type: "cat" | "dog" | null;
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
  targeting_data: null | {
    organization?: boolean | number | string;
    advertisement?: boolean | number | string;
    matched_terms?: unknown;
    ownership_terms?: unknown;
    post_excerpt?: unknown;
    source?: unknown;
    [key: string]: unknown;
  };
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
