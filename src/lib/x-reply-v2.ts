import { createHmac } from "node:crypto";
import { getAppUrl, getMarketingIngestSecret } from "@/lib/env";
import { hashMarketingToken } from "@/lib/marketing";
import { getActiveAccountProducts, type ActiveAccountProduct } from "@/lib/x-lead-account-products";
import { selectAccountDraft, type AccountDraftInput } from "@/lib/x-lead-account-draft";
import { getActiveFirstOrderPromotion, type FirstOrderPromotion } from "@/lib/first-order-promotion";
import { canAdvertiseFirstOrder25 } from "@/lib/x-lead-copy";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { validAccountDesignAsset } from "@/lib/x-account-design-assets";

export const X_REPLY_V2_CAPABILITY = "account_product_link_v2";
export const X_REPLY_V2_WORKER_MIN_VERSION = "4.11.0";
export const X_REPLY_V2_PREVIEW_CAPABILITY = "account_product_preview_v2";
type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceClient>>;

export type V2Snapshot = {
  id?: string;
  queue_version: number;
  content_mode: string;
  target_author_id: string | null;
  account_draft_author_id: string | null;
  marketing_link_id: string | null;
  source_post_id: string | null;
  draft_generated_at: string | null;
  target_post_url: string | null;
  reply_text: string;
  account_artwork_path?: string | null;
  account_artwork_hash?: string | null;
  account_preview_path?: string | null;
  account_preview_hash?: string | null;
  account_preview_template_id?: string | null;
};

export function supportsXReplyV2Worker(version: string | null | undefined) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(version ?? "");
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  return parts[0] > 4 || parts[0] === 4 && (parts[1] > 11 || parts[1] === 11 && parts[2] >= 0);
}

export function supportsXReplyV2PreviewWorker(version: string | null | undefined) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(version ?? "");
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major > 4 || major === 4 && (minor > 12 || minor === 12 && patch >= 0);
}

export function isValidV2ReplyText(text: string, marketingUrl: string) {
  if (!text || text.length > 280 || !marketingUrl) return false;
  const urls = text.match(/https?:\/\/[^\s]+/g) ?? [];
  return urls.length === 1 && urls[0] === marketingUrl;
}

export function v2OwnPostIsCurrent(account: AccountDraftInput, postId: string, now: Date) {
  const ids = Array.isArray(account.account_evidence.own_post_ids) ? account.account_evidence.own_post_ids : [];
  if (!ids.includes(postId)) return false;
  const posts = Array.isArray(account.account_evidence.own_posts) ? account.account_evidence.own_posts : [];
  return posts.some((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const post = raw as Record<string, unknown>;
    const created = Date.parse(String(post.created_at ?? ""));
    return String(post.post_id) === postId && String(post.author_id ?? account.author_id) === account.author_id
      && typeof post.text === "string" && post.text.trim().length > 0
      && post.is_repost !== true && post.isRetweet !== true && !post.retweeted_tweet && !post.retweetedTweet
      && !(post.source === "reply" && !["seed_is_direct_parent", "exact_parent_verified"].includes(String(post.direct_parent_status ?? "")))
      && Number.isFinite(created) && created <= now.getTime() + 5 * 60_000
      && now.getTime() - created <= 14 * 24 * 60 * 60_000;
  });
}

export type V2EvidenceInput = {
  job: V2Snapshot;
  account: AccountDraftInput & { x_handle?: string | null };
  draft: { author_id: string; status: string; review_status: string; selected_post_id: string | null;
    product_slug: string | null; reply_text: string | null; marketing_link_id: string | null;
    marketing_url: string | null; marketing_expires_at: string | null; generated_at: string;
    preview_status?: string | null; design_source?: string | null; design_brief?: string | null;
    artwork_path?: string | null; artwork_hash?: string | null; preview_path?: string | null;
    preview_hash?: string | null; preview_template_id?: string | null };
  link: { channel: string; product_slug: string | null; x_post_id: string | null;
    x_author_hash: string | null; source_image_url: string | null; token_hash: string; expires_at: string;
    account_artwork_path?: string | null; account_artwork_hash?: string | null;
    account_preview_path?: string | null; account_preview_hash?: string | null;
    account_preview_template_id?: string | null };
  products: ActiveAccountProduct[];
  promotion: FirstOrderPromotion | null;
  now: Date;
  appUrl: string;
  secret: string;
};

/** Pure snapshot check for archived-data tests; the live wrapper loads current records each time. */
export function validateV2Evidence({ job, account: input, draft, link, products, promotion, now, appUrl, secret }: V2EvidenceInput): string | null {
  const previewMode = job.content_mode === "account_product_preview";
  if (job.queue_version !== 2 || !["account_product_link", "account_product_preview"].includes(job.content_mode)
    || !job.target_author_id || job.account_draft_author_id !== job.target_author_id
    || !job.marketing_link_id || !job.source_post_id || !job.draft_generated_at
    || !/^https:\/\/x\.com\/[A-Za-z0-9_]{1,50}\/status\/\d+$/.test(job.target_post_url ?? "")
    || !job.target_post_url?.endsWith(`/status/${job.source_post_id}`)) return "队列账号或本人帖快照无效。";
  const evidence = input.account_evidence;
  if (input.review_status === "dismissed" || input.account_status === "excluded" || evidence.exclusion_reason
    || input.entry_status === "hold" || draft.status !== "draft_ready" || draft.review_status === "dismissed") return "账号或草稿已忽略、排除或暂缓。";
  if (input.x_handle && job.target_post_url !== `https://x.com/${input.x_handle.replace(/^@/, "")}/status/${job.source_post_id}`)
    return "账号 handle 与待回复原帖链接不一致。";
  if (!v2OwnPostIsCurrent(input, job.source_post_id, now)) return "所选本人帖已过期或归属证据失效。";
  const product = products.find((item) => item.slug === draft.product_slug);
  if (!product) return "选中商品已下架、无可售规格或模板不可用。";
  if (previewMode) {
    const asset = { artworkPath: job.account_artwork_path ?? "", artworkHash: job.account_artwork_hash ?? "",
      previewPath: job.account_preview_path ?? "", previewHash: job.account_preview_hash ?? "",
      templateId: job.account_preview_template_id ?? "" };
    if (draft.preview_status !== "ready" || draft.design_source !== "brand_created" || !draft.design_brief
      || !validAccountDesignAsset(asset, product.slug) || !product.mockupTemplateIds?.includes(asset.templateId)
      || draft.artwork_path !== asset.artworkPath || draft.artwork_hash !== asset.artworkHash
      || draft.preview_path !== asset.previewPath || draft.preview_hash !== asset.previewHash
      || draft.preview_template_id !== asset.templateId
      || link.account_artwork_path !== asset.artworkPath || link.account_artwork_hash !== asset.artworkHash
      || link.account_preview_path !== asset.previewPath || link.account_preview_hash !== asset.previewHash
      || link.account_preview_template_id !== asset.templateId) return "预览原画、商品模板或已审素材快照已失效。";
  } else if (draft.preview_status === "ready" || job.account_artwork_path || link.account_artwork_path) {
    return "文字版队列与图片草稿不一致，请重建待审任务。";
  }
  const current = selectAccountDraft(input, products, now);
  if (current.status !== "draft_ready" || current.selectedPost?.post_id !== job.source_post_id
    || current.productSlug !== draft.product_slug) return "账号当前证据不再支持已审草稿，请重新生成。";
  if (draft.author_id !== job.target_author_id || draft.selected_post_id !== job.source_post_id
    || draft.generated_at !== job.draft_generated_at || draft.marketing_link_id !== job.marketing_link_id
    || draft.reply_text !== job.reply_text) return "草稿已变更，原审核快照不可发送。";
  const expiry = Date.parse(String(draft.marketing_expires_at ?? ""));
  if (!Number.isFinite(expiry) || expiry <= now.getTime() + 24 * 60 * 60_000
    || Date.parse(String(link.expires_at ?? "")) !== expiry) return "追踪链接即将或已经过期。";
  const url = String(draft.marketing_url ?? "");
  const parsed = URL.canParse(url) ? new URL(url) : null;
  const app = new URL(appUrl);
  const token = parsed?.pathname.match(/^\/g\/([A-Za-z0-9_-]{10,64})$/)?.[1];
  if (!parsed || parsed.origin !== app.origin || !token || !secret || hashMarketingToken(token) !== link.token_hash
    || link.channel !== "public_reply" || link.source_image_url !== null
    || link.product_slug !== draft.product_slug || link.x_post_id !== job.source_post_id
    || link.x_author_hash !== createHmac("sha256", secret).update(`x-author:${job.target_author_id}`).digest("hex")
    || !isValidV2ReplyText(job.reply_text, url)) return "商品链接、作者或文案与已审快照不一致。";
  const advertised = /\b25%\s+off\b/i.test(job.reply_text);
  if (advertised && !canAdvertiseFirstOrder25(promotion, product.variants)) return "首单优惠已变更，请重生成并重新审阅。";
  return null;
}

/** One authoritative, read-only check shared by admin approval and worker claim. */
export async function validateV2Snapshot(supabase: ServiceClient, job: V2Snapshot, now = new Date()): Promise<string | null> {
  if (!job.target_author_id || !job.marketing_link_id) return "队列身份缺失。";
  const [{ data: account, error: accountError }, { data: draft, error: draftError }, { data: link, error: linkError }, products, promotion] = await Promise.all([
    supabase.from("x_lead_account_reviews").select("author_id,x_handle,account_status,entry_status,review_status,account_evidence,entry_evidence")
      .eq("author_id", job.target_author_id).maybeSingle(),
    supabase.from("x_lead_account_drafts").select("author_id,status,review_status,selected_post_id,product_slug,reply_text,marketing_link_id,marketing_url,marketing_expires_at,generated_at,preview_status,design_source,design_brief,artwork_path,artwork_hash,preview_path,preview_hash,preview_template_id")
      .eq("author_id", job.target_author_id).maybeSingle(),
    supabase.from("marketing_links").select("id,channel,product_slug,x_post_id,x_author_hash,source_image_url,token_hash,expires_at,account_artwork_path,account_artwork_hash,account_preview_path,account_preview_hash,account_preview_template_id")
      .eq("id", job.marketing_link_id).maybeSingle(),
    getActiveAccountProducts(), getActiveFirstOrderPromotion(),
  ]);
  if (accountError || draftError || linkError || !account || !draft || !link) return "账号、草稿或追踪链接不可读。";
  const evidence = account.account_evidence && typeof account.account_evidence === "object" && !Array.isArray(account.account_evidence)
    ? account.account_evidence as Record<string, unknown> : {};
  const entry = account.entry_evidence && typeof account.entry_evidence === "object" && !Array.isArray(account.entry_evidence)
    ? account.entry_evidence as Record<string, unknown> : {};
  const secret = getMarketingIngestSecret();
  if (!secret) return "追踪链接校验密钥不可用。";
  return validateV2Evidence({ job, account: { ...account, account_evidence: evidence, entry_evidence: entry },
    draft, link, products, promotion, now, appUrl: getAppUrl(), secret });
}

/** Historical contacts are checked globally, independently of sender account. */
export async function hasPriorXContact(supabase: ServiceClient, authorId: string, handle: string, postId: string, exceptJobId?: string) {
  const normalized = handle.toLowerCase().replace(/^@/, "");
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error } = await supabase.from("x_reply_jobs")
      .select("id,target_author_id,target_post_url").in("status", ["queued", "claimed", "sent", "uncertain"])
      .order("id").range(offset, offset + 499);
    if (error || !data) throw new Error("Historical reply contacts unavailable");
    for (const row of data) {
      if (row.id === exceptJobId) continue;
      const url = String(row.target_post_url ?? "");
      if (authorId && row.target_author_id === authorId || url.endsWith(`/status/${postId}`)
        || new RegExp(`^https://(?:www\\.)?(?:x|twitter)\\.com/${normalized}/status/`, "i").test(url)) return true;
    }
    if (data.length < 500) break;
    if (offset === 9500) throw new Error("Historical reply contacts exceeded bound");
  }
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error } = await supabase.from("x_manual_posts")
      .select("id,target_post_url").eq("status", "sent")
      .order("id").range(offset, offset + 499);
    if (error || !data) throw new Error("Historical manual contacts unavailable");
    for (const row of data) {
      const url = String(row.target_post_url ?? "");
      if (url.endsWith(`/status/${postId}`)
        || new RegExp(`^https://(?:www\\.)?(?:x|twitter)\\.com/${normalized}/status/`, "i").test(url)) return true;
    }
    if (data.length < 500) break;
    if (offset === 9500) throw new Error("Historical manual contacts exceeded bound");
  }
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error } = await supabase.from("x_leads")
      .select("post_id,x_handle,targeting_data").in("selection_status", ["contacted", "suppressed"])
      .order("id").range(offset, offset + 499);
    if (error || !data) throw new Error("Historical lead contacts unavailable");
    for (const row of data) {
      const target = row.targeting_data && typeof row.targeting_data === "object" && !Array.isArray(row.targeting_data)
        ? row.targeting_data as Record<string, unknown> : {};
      if (String(row.post_id ?? "") === postId || String(row.x_handle ?? "").toLowerCase().replace(/^@/, "") === normalized
        || authorId && [target.demand_author_id, target.author_id, target.authorId, target.x_author_id].some((id) => String(id ?? "") === authorId)) return true;
    }
    if (data.length < 500) break;
    if (offset === 9500) throw new Error("Historical lead contacts exceeded bound");
  }
  return false;
}
