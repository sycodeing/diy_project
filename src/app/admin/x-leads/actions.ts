"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prepareXLeadQueueTask } from "@/lib/x-lead-materials";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getXLeadTargetingChecks, type XLeadRow } from "@/lib/x-lead";

const leadIdSchema = z.uuid();
const suitabilityDecisionSchema = z.enum(["reject", "restore"]);
const PREPARING_COPY = "Preparing your personalized pet-pillow preview and link…";
const RESTORABLE_SELECTION_STATUSES = new Set([
  "new",
  "location_review",
  "targeting_review",
  "rejected_targeting",
  "review",
]);

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

async function getLeadAndAssignedAccount(leadId: string) {
  const { supabase, lead } = await getEligibleLead(leadId);
  const { data: accounts, error: accountsError } = await supabase
    .from("x_reply_accounts")
    .select("id,created_at")
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (accountsError) throw new Error(accountsError.message);
  if (!accounts?.length) throw new Error("还没有启用的发送账号，请先到自动发送页配置账号定位。");

  const accountIds = accounts.map((account) => account.id);
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data: automaticRows } = await supabase
    .from("x_reply_jobs")
    .select("account_id")
    .in("account_id", accountIds)
    .gte("created_at", since)
    .neq("status", "rejected");
  const load = new Map(accountIds.map((id) => [id, 0]));
  for (const row of automaticRows ?? []) {
    load.set(row.account_id, (load.get(row.account_id) ?? 0) + 1);
  }
  const account = [...accounts].sort((left, right) => (load.get(left.id) ?? 0) - (load.get(right.id) ?? 0))[0];
  return { supabase, lead, account };
}

export async function createXLeadManualTask(formData: FormData) {
  const user = await requireAdmin("/admin/x-leads");
  const leadId = leadIdSchema.parse(String(formData.get("leadId") ?? ""));
  const { supabase, lead } = await getEligibleLead(leadId);
  const { data: task, error } = await supabase.from("x_manual_posts").insert({
    x_lead_id: leadId,
    action_type: "reply",
    target_post_url: lead.post_url,
    post_text: PREPARING_COPY,
    status: "draft",
    preparation_status: "pending",
    created_by: user.id,
  }).select("id").single();
  if (error || !task) throw new Error(error?.message ?? "手动发送任务创建失败。");
  await supabase.from("x_leads").update({ selection_status: "approved" }).eq("id", leadId);
  after(() => prepareXLeadQueueTask({ queue: "manual", taskId: task.id, leadId }));
  revalidatePath("/admin/x-leads");
  revalidatePath("/admin/x-manual-posts");
}

export async function createXLeadAutoTask(formData: FormData) {
  const user = await requireAdmin("/admin/x-leads");
  const leadId = leadIdSchema.parse(String(formData.get("leadId") ?? ""));
  const { supabase, lead, account } = await getLeadAndAssignedAccount(leadId);
  const { data: task, error } = await supabase.from("x_reply_jobs").insert({
    account_id: account.id,
    x_lead_id: leadId,
    action_type: "reply",
    target_post_url: lead.post_url,
    reply_text: PREPARING_COPY,
    scheduled_for: new Date(Date.now() + 30 * 60_000).toISOString(),
    status: "draft",
    preparation_status: "pending",
    created_by: user.id,
  }).select("id").single();
  if (error || !task) throw new Error(error?.message ?? "自动发送草稿创建失败。");
  await supabase.from("x_leads").update({ selection_status: "approved" }).eq("id", leadId);
  after(() => prepareXLeadQueueTask({ queue: "automatic", taskId: task.id, leadId }));
  revalidatePath("/admin/x-leads");
  revalidatePath("/admin/x-auto-posts");
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
    targetingData.manual_previous_status = lead.selection_status;
    targetingData.manual_rejected_at = new Date().toISOString();
    nextStatus = "rejected";
  } else {
    if (lead.selection_status !== "rejected") throw new Error("该候选当前不是人工标记的不合适状态。");
    const previousStatus = typeof targetingData.manual_previous_status === "string"
      ? targetingData.manual_previous_status
      : "review";
    nextStatus = RESTORABLE_SELECTION_STATUSES.has(previousStatus) ? previousStatus : "review";
    delete targetingData.manual_previous_status;
    delete targetingData.manual_rejected_at;
  }

  const { data: updated, error: updateError } = await supabase
    .from("x_leads")
    .update({ selection_status: nextStatus, targeting_data: targetingData })
    .eq("id", leadId)
    .eq("selection_status", lead.selection_status)
    .select("id")
    .maybeSingle();
  if (updateError || !updated) throw new Error(updateError?.message ?? "候选状态已变化，请刷新后重试。");
  revalidatePath("/admin/x-leads");
}
