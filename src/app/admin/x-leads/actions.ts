"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prepareXLeadQueueTask } from "@/lib/x-lead-materials";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getXLeadTargetingChecks, X_LEAD_REJECTION_REASONS, type XLeadRow } from "@/lib/x-lead";

const leadIdSchema = z.uuid();
const accountIdSchema = z.uuid();
const suitabilityDecisionSchema = z.enum(["reject", "restore"]);
const rejectionReasonSchema = z.enum(X_LEAD_REJECTION_REASONS);
const mediaUrlSchema = z.url().max(2048).refine((value) => value.startsWith("https://"));
const PREPARING_COPY = "Preparing your personalized pet-pillow preview and link…";
const RESTORABLE_SELECTION_STATUSES = new Set([
  "new",
  "location_review",
  "targeting_review",
  "rejected_targeting",
  "review",
]);

export type QueueActionResult =
  | { ok: true }
  | { ok: false; error: string };

function queueActionError(error: unknown, fallback: string): QueueActionResult {
  const message = error instanceof Error ? error.message : "";
  const safeMessage = [
    "该候选",
    "第一期",
    "候选未达到发送标准",
    "当前没有绑定 Mac 执行器",
    "选择的 X 账号",
    "该 X 账号",
  ].some((prefix) => message.startsWith(prefix));
  return {
    ok: false,
    error: safeMessage ? message : fallback,
  };
}

async function getEligibleLead(leadId: string) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端连接尚未配置。");
  const [{ data: lead, error: leadError }, { data: searchConfig }] = await Promise.all([
    supabase.from("x_leads").select("id,post_url,selection_status,pet_type,us_confidence,us_evidence,ownership_confidence,occasion_confidence,targeting_data").eq("id", leadId).maybeSingle(),
    supabase.from("x_lead_search_configs").select("us_min_confidence").eq("config_key", "default").maybeSingle(),
  ]);
  if (leadError || !lead) throw new Error(leadError?.message ?? "候选用户不存在。");
  if (["approved", "contacted", "rejected", "suppressed"].includes(lead.selection_status)) {
    throw new Error("该候选已进入发送流程、已被拒绝或已设置为不再联系，不能重复创建任务。");
  }
  if (!lead.pet_type || !["cat", "dog"].includes(lead.pet_type)) {
    throw new Error("第一期只允许已确认是猫或狗的候选进入发送队列。");
  }
  const failedChecks = getXLeadTargetingChecks(
    lead as unknown as XLeadRow,
    searchConfig?.us_min_confidence ?? 70,
  ).filter((check) => !check.passed);
  if (failedChecks.length) {
    throw new Error(`候选未达到发送标准：${failedChecks.map((check) => `${check.label}（${check.actual}，要求${check.standard}）`).join("；")}`);
  }
  return { supabase, lead };
}

async function getLeadAndSelectedAccount(leadId: string, accountId: string) {
  const { supabase, lead } = await getEligibleLead(leadId);
  const { data: account, error: accountError } = await supabase
    .from("x_reply_accounts")
    .select("id,account_key,display_name,positioning,daily_limit,active,executor_id")
    .eq("id", accountId)
    .eq("active", true)
    .maybeSingle();
  if (accountError || !account) throw new Error(accountError?.message ?? "选择的 X 账号不存在或已经停用。");
  if (!account.executor_id) throw new Error("选择的 X 账号尚未绑定 Mac 执行器。");

  const local = new Date(Date.now() + 8 * 60 * 60_000);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 8 * 60 * 60_000;
  const { count, error: countError } = await supabase
    .from("x_reply_jobs")
    .select("id", { count: "exact", head: true })
    .eq("account_id", account.id)
    .in("status", ["queued", "claimed", "sent", "uncertain"])
    .gte("scheduled_for", new Date(start).toISOString())
    .lt("scheduled_for", new Date(start + 24 * 60 * 60_000).toISOString());
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) >= account.daily_limit) throw new Error(`该 X 账号 @${account.account_key} 已达到今日发送上限。`);
  return { supabase, lead, account };
}

export async function createXLeadManualTask(formData: FormData): Promise<QueueActionResult> {
  const user = await requireAdmin("/admin/x-leads");
  try {
    const leadId = leadIdSchema.parse(String(formData.get("leadId") ?? ""));
    const supabase = getSupabaseServiceClient();
    if (!supabase) throw new Error("Supabase 服务端连接尚未配置。");
    const { data: existingTask, error: existingTaskError } = await supabase
      .from("x_manual_posts")
      .select("id")
      .eq("x_lead_id", leadId)
      .maybeSingle();
    if (existingTaskError) throw new Error(existingTaskError.message);
    if (existingTask) return { ok: true };

    const { lead } = await getEligibleLead(leadId);
    const { data: task, error } = await supabase.from("x_manual_posts").insert({
      x_lead_id: leadId,
      action_type: "reply",
      target_post_url: lead.post_url,
      post_text: PREPARING_COPY,
      status: "draft",
      preparation_status: "pending",
      created_by: user.id,
    }).select("id").single();
    if (error?.code === "23505") return { ok: true };
    if (error || !task) throw new Error(error?.message ?? "手动发送任务创建失败。");
    const { error: updateLeadError } = await supabase.from("x_leads").update({ selection_status: "approved" }).eq("id", leadId);
    if (updateLeadError) throw new Error(`手动任务已创建，但候选状态更新失败：${updateLeadError.message}`);
    after(() => prepareXLeadQueueTask({ queue: "manual", taskId: task.id, leadId }));
    return { ok: true };
  } catch (error) {
    return queueActionError(error, "手动发送任务创建失败，请稍后重试。");
  }
}

export async function createXLeadAutoTask(formData: FormData): Promise<QueueActionResult> {
  const user = await requireAdmin("/admin/x-leads");
  try {
    const leadId = leadIdSchema.parse(String(formData.get("leadId") ?? ""));
    const accountId = accountIdSchema.parse(String(formData.get("accountId") ?? ""));
    const { supabase, lead, account } = await getLeadAndSelectedAccount(leadId, accountId);
    const { data: existingTask, error: existingTaskError } = await supabase
      .from("x_reply_jobs")
      .select("id")
      .eq("x_lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingTaskError) throw new Error(existingTaskError.message);
    if (existingTask) return { ok: true };
    const { data: task, error } = await supabase.from("x_reply_jobs").insert({
      account_id: account.id,
      x_lead_id: leadId,
      action_type: "reply",
      target_post_url: lead.post_url,
      reply_text: "Preparing a text-only first-contact message…",
      content_mode: "first_contact_text",
      scheduled_for: new Date().toISOString(),
      status: "draft",
      preparation_status: "pending",
      account_key_snapshot: account.account_key,
      positioning_snapshot: account.positioning,
      created_by: user.id,
    }).select("id").single();
    if (error?.code === "23505") return { ok: true };
    if (error || !task) throw new Error(error?.message ?? "自动发送草稿创建失败。");
    const { error: updateLeadError } = await supabase.from("x_leads").update({ selection_status: "approved" }).eq("id", leadId);
    if (updateLeadError) throw new Error(`自动草稿已创建，但候选状态更新失败：${updateLeadError.message}`);
    after(() => prepareXLeadQueueTask({ queue: "automatic", taskId: task.id, leadId }));
    return { ok: true };
  } catch (error) {
    return queueActionError(error, "自动发送草稿创建失败，请稍后重试。");
  }
}

export async function blacklistXLeadAccount(formData: FormData) {
  const user = await requireAdmin("/admin/x-leads");
  const leadId = leadIdSchema.parse(String(formData.get("leadId") ?? ""));
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端连接尚未配置。");

  const { data: lead, error: leadError } = await supabase
    .from("x_leads")
    .select("author_hash,x_handle")
    .eq("id", leadId)
    .maybeSingle();
  if (leadError || !lead) throw new Error(leadError?.message ?? "候选用户不存在。");

  const { error: blacklistError } = await supabase.from("x_lead_account_blacklist").upsert({
    author_hash: lead.author_hash,
    x_handle: lead.x_handle,
    reason: "manual_review",
    created_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "author_hash" });
  if (blacklistError) throw new Error(blacklistError.message);

  const { error: suppressError } = await supabase
    .from("x_leads")
    .update({ selection_status: "suppressed" })
    .eq("author_hash", lead.author_hash)
    .not("selection_status", "in", '("approved","contacted")');
  if (suppressError) throw new Error(suppressError.message);
  // Deliberately do not revalidate /admin/x-leads. The operator's current queue
  // remains stable until they explicitly refresh it.
}

export async function setXLeadSuitability(formData: FormData) {
  await requireAdmin("/admin/x-leads");
  const leadId = leadIdSchema.parse(String(formData.get("leadId") ?? ""));
  const decision = suitabilityDecisionSchema.parse(String(formData.get("decision") ?? ""));
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端连接尚未配置。");

  const { data: lead, error: leadError } = await supabase
    .from("x_leads")
    .select("id,selection_status,targeting_data")
    .eq("id", leadId)
    .maybeSingle();
  if (leadError || !lead) throw new Error(leadError?.message ?? "候选用户不存在。");

  const targetingData = lead.targeting_data && typeof lead.targeting_data === "object"
    ? { ...lead.targeting_data }
    : {};
  let nextStatus: string;
  if (decision === "reject") {
    if (["approved", "contacted", "suppressed"].includes(lead.selection_status)) {
      throw new Error("该候选已进入发送流程或不再联系，不能改为不合适。");
    }
    if (lead.selection_status === "rejected") return;
    const rejectionReason = rejectionReasonSchema.parse(String(formData.get("rejectionReason") ?? ""));
    const rejectionNote = z.string().trim().max(200).parse(String(formData.get("rejectionNote") ?? ""));
    if (rejectionReason === "other" && !rejectionNote) throw new Error("选择其他原因时，请填写具体说明。");
    targetingData.manual_previous_status = lead.selection_status;
    targetingData.manual_rejected_at = new Date().toISOString();
    targetingData.manual_rejection_reason = rejectionReason;
    targetingData.manual_rejection_note = rejectionNote;
    nextStatus = "rejected";
  } else {
    if (lead.selection_status !== "rejected") throw new Error("该候选当前不是人工标记的不合适状态。");
    const previousStatus = typeof targetingData.manual_previous_status === "string"
      ? targetingData.manual_previous_status
      : "review";
    nextStatus = RESTORABLE_SELECTION_STATUSES.has(previousStatus) ? previousStatus : "review";
    delete targetingData.manual_previous_status;
    delete targetingData.manual_rejected_at;
    delete targetingData.manual_rejection_reason;
    delete targetingData.manual_rejection_note;
  }

  const { data: updated, error: updateError } = await supabase
    .from("x_leads")
    .update({ selection_status: nextStatus, targeting_data: targetingData })
    .eq("id", leadId)
    .eq("selection_status", lead.selection_status)
    .select("id")
    .maybeSingle();
  if (updateError || !updated) throw new Error(updateError?.message ?? "候选状态已变化，请刷新后重试。");
  // Deliberately keep the current queue snapshot and ordering until manual refresh.
}

export async function selectXLeadMedia(formData: FormData) {
  await requireAdmin("/admin/x-leads");
  const leadId = leadIdSchema.parse(String(formData.get("leadId") ?? ""));
  const mediaUrl = mediaUrlSchema.parse(String(formData.get("mediaUrl") ?? ""));
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端连接尚未配置。");

  const { data: lead, error: leadError } = await supabase
    .from("x_leads")
    .select("id,media_url,media_urls,selection_status,marketing_link_id,x_manual_posts(id)")
    .eq("id", leadId)
    .maybeSingle();
  if (leadError || !lead) throw new Error(leadError?.message ?? "候选用户不存在。");
  const mediaUrls = Array.isArray(lead.media_urls) && lead.media_urls.length ? lead.media_urls : [lead.media_url];
  if (!mediaUrls.includes(mediaUrl)) throw new Error("所选图片不属于该候选帖子。");
  if (lead.marketing_link_id || (lead.x_manual_posts?.length ?? 0) > 0 || ["approved", "contacted", "suppressed"].includes(lead.selection_status)) {
    throw new Error("该候选已进入素材或发送流程，不能再更换主图。");
  }
  if (lead.media_url === mediaUrl) return;

  const { data: updated, error: updateError } = await supabase
    .from("x_leads")
    .update({ media_url: mediaUrl })
    .eq("id", leadId)
    .eq("media_url", lead.media_url)
    .select("id")
    .maybeSingle();
  if (updateError || !updated) throw new Error(updateError?.message ?? "候选图片已变化，请刷新后重试。");
  revalidatePath("/admin/x-leads");
}
