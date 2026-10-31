import { createHash, createHmac, randomBytes } from "node:crypto";
import { getAppUrl, getMarketingIngestSecret } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { createXLeadDrafts, getXLeadShortCopyVariant, type XLeadCopyProfile } from "@/lib/x-lead-copy";
import { getXLeadTargetingChecks, type XLeadRow } from "@/lib/x-lead";

type QueueKind = "manual" | "automatic";

export async function ensureXLeadMarketingAssets(
  leadId: string,
  previewMode: "reply" | "full" = "full",
  copyProfile?: XLeadCopyProfile,
) {
  const supabase = getSupabaseServiceClient();
  const secret = getMarketingIngestSecret();
  if (!supabase || !secret) throw new Error("营销链接服务尚未配置。");

  const [{ data: lead, error }, { data: searchConfig }] = await Promise.all([
    supabase
      .from("x_leads")
      .select("id,post_id,author_hash,x_handle,post_url,media_url,segment,lead_score,selection_status,pet_type,occasion,us_confidence,us_evidence,ownership_confidence,occasion_confidence,targeting_data")
      .eq("id", leadId)
      .maybeSingle(),
    supabase.from("x_lead_search_configs").select("us_min_confidence").eq("config_key", "default").maybeSingle(),
  ]);
  if (error || !lead) throw new Error(error?.message ?? "X 用户不存在。");
  if (["rejected", "suppressed"].includes(lead.selection_status)) {
    throw new Error("该用户已被拒绝或设置为不再联系，不能生成预览图。");
  }
  if (!lead.pet_type || !["cat", "dog"].includes(lead.pet_type)) {
    throw new Error("第一期只为已确认的猫、狗生成预览图。");
  }
  const failedChecks = getXLeadTargetingChecks(
    lead as unknown as XLeadRow,
    searchConfig?.us_min_confidence ?? 70,
  ).filter((check) => !check.passed);
  if (failedChecks.length) {
    throw new Error(`候选未达到生成素材的硬性条件：${failedChecks.map((check) => check.label).join("、")}`);
  }

  const dateKey = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const campaign = `x_${lead.segment}_${dateKey}`;
  const channel = "direct_message";
  const variant = getXLeadShortCopyVariant(lead.post_id);
  const sourceHash = createHmac("sha256", secret).update(`x-post:${lead.post_id}`).digest("hex");
  const linkCycle = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const material = `${lead.post_id}\n${campaign}\n${channel}\n${variant}\n${linkCycle}`;
  const idempotencyKey = `x-link:${createHash("sha256").update(material).digest("hex")}`;
  const payload = {
    campaign,
    channel,
    variant,
    sourceHash,
    sourceImageUrl: lead.media_url,
    previewMode,
    xLead: {
      leadId: lead.id,
      authorHash: lead.author_hash,
      handle: lead.x_handle,
      postId: lead.post_id,
      postUrl: lead.post_url,
      segment: lead.segment,
      ...(lead.lead_score === null ? {} : { score: lead.lead_score }),
    },
  };
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(24).toString("base64url");
  const canonical = `${timestamp}\n${nonce}\n${idempotencyKey}\n${body}`;
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  const response = await fetch(`${getAppUrl()}/api/marketing/links`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-marketing-timestamp": timestamp,
      "x-marketing-nonce": nonce,
      "x-marketing-idempotency-key": idempotencyKey,
      "x-marketing-signature": signature,
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(115_000),
  });
  const result = await response.json().catch(() => null) as {
    url?: string;
    previewCacheReady?: boolean;
    error?: string;
  } | null;
  if (!response.ok || !result?.url) {
    throw new Error(result?.error ?? "生成专属链接或预览图失败，请稍后重试。");
  }

  const { data: marketingLink, error: linkError } = await supabase
    .from("marketing_links")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .single();
  if (linkError || !marketingLink) throw new Error(linkError?.message ?? "专属链接记录不存在。");

  const drafts = createXLeadDrafts({
    occasion: lead.occasion,
    occasionConfidence: lead.occasion_confidence,
    petType: lead.pet_type,
    targetingData: lead.targeting_data,
  }, result.url, copyProfile, variant);
  if (drafts.variantKey !== variant) {
    throw new Error("营销文案实验版本与归因版本不一致。");
  }
  if (!drafts.publicCopy.includes(result.url)) {
    throw new Error("营销文案未包含专属跳转链接。");
  }
  const { error: updateError } = await supabase.from("x_leads").update({
    marketing_link_id: marketingLink.id,
    consent_copy: drafts.consentCopy,
    public_copy: drafts.publicCopy,
    direct_message_copy: drafts.directMessageCopy,
  }).eq("id", lead.id);
  if (updateError) throw new Error(updateError.message);

  return {
    url: result.url,
    previewCacheReady: result.previewCacheReady === true,
    marketingLinkId: marketingLink.id,
    drafts,
  };
}

export async function prepareXLeadQueueTask({
  queue,
  taskId,
  leadId,
}: {
  queue: QueueKind;
  taskId: string;
  leadId: string;
}) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return;
  const table = queue === "manual" ? "x_manual_posts" : "x_reply_jobs";

  await supabase.from(table).update({
    preparation_status: "processing",
    preparation_error: null,
  }).eq("id", taskId).in("preparation_status", ["pending", "failed"]);

  try {
    let copyProfile: XLeadCopyProfile | undefined;
    if (queue === "automatic") {
      const { data: automaticTask, error: taskError } = await supabase
        .from("x_reply_jobs")
        .select("x_reply_accounts!inner(account_key,copy_style,voice,positioning,copy_variation_notes)")
        .eq("id", taskId)
        .maybeSingle();
      if (taskError || !automaticTask) throw new Error(taskError?.message ?? "自动发送账号不存在。");
      const relation = Array.isArray(automaticTask.x_reply_accounts)
        ? automaticTask.x_reply_accounts[0]
        : automaticTask.x_reply_accounts;
      if (!relation) throw new Error("自动发送账号不存在。");
      copyProfile = {
        accountKey: relation.account_key,
        style: relation.copy_style,
        voice: relation.voice,
        positioning: relation.positioning,
        variationNotes: relation.copy_variation_notes,
        variationSeed: taskId,
      };
    } else {
      copyProfile = {
        accountKey: "manual-review",
        style: "warm",
        voice: "warm, specific, and respectful",
        positioning: "private custom pet keepsake previews",
        variationSeed: `${leadId}:${taskId}`,
      };
    }
    const assets = await ensureXLeadMarketingAssets(leadId, "reply", copyProfile);
    if (!assets.previewCacheReady) throw new Error("宠物图片已找到，但预览图生成失败，请稍后重试。");
    const contentField = queue === "manual"
      ? { post_text: assets.drafts.publicCopy }
      : { reply_text: assets.drafts.publicCopy };
    const preparedAt = new Date().toISOString();
    const downloadFields = queue === "manual" ? {
      preview_download_status: "pending",
      preview_download_worker_id: null,
      preview_download_error: null,
      preview_download_requested_at: preparedAt,
      preview_downloaded_at: null,
    } : {};
    let update = supabase.from(table).update({
      ...contentField,
      ...downloadFields,
      preparation_status: "ready",
      preparation_error: null,
      prepared_at: preparedAt,
    }).eq("id", taskId);
    if (queue === "manual") update = update.eq("status", "draft");
    const { error } = await update;
    if (error) throw error;
  } catch (error) {
    const message = error instanceof Error ? error.message : "营销素材生成失败。";
    await supabase.from(table).update({
      preparation_status: "failed",
      preparation_error: message.slice(0, 1000),
    }).eq("id", taskId);
  }
}
