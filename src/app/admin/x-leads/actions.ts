"use server";

import { after } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prepareXLeadQueueTask } from "@/lib/x-lead-materials";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getXLeadTargetingChecks, X_LEAD_REJECTION_REASONS, type XLeadRow } from "@/lib/x-lead";
import { isXAccountClaimEligible } from "@/lib/x-reply-safety";

const leadIdSchema = z.uuid();
const suitabilityDecisionSchema = z.enum(["reject", "restore"]);
const rejectionReasonSchema = z.enum(X_LEAD_REJECTION_REASONS);
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
  return {
    ok: false,
    error: error instanceof Error && error.message ? error.message : fallback,
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

async function getLeadAndAssignedAccount(leadId: string) {
  const { supabase, lead } = await getEligibleLead(leadId);
  const { data: accounts, error: accountsError } = await supabase
    .from("x_reply_accounts")
    .select("id,created_at,account_key,executor_id,network_mode,expected_egress_ip,x_reply_account_proxies(status)")
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (accountsError) throw new Error(accountsError.message);
  const executorIds = Array.from(new Set((accounts ?? []).flatMap((account) => account.executor_id ? [account.executor_id] : [])));
  const workers = executorIds.length
    ? await supabase
      .from("x_reply_workers")
      .select("executor_id,execution_mode,xuse_available,configured_accounts,current_egress_ip,network_probe_status,last_seen_at")
      .in("executor_id", executorIds)
      .gte("last_seen_at", new Date(Date.now() - 5 * 60_000).toISOString())
    : { data: [], error: null };
  if (workers.error) throw new Error(workers.error.message);
  const workerByExecutor = new Map((workers.data ?? []).flatMap((worker) => worker.executor_id ? [[worker.executor_id, worker] as const] : []));
  const assignableAccounts = (accounts ?? []).filter((account) => Boolean(account.executor_id));
  if (!assignableAccounts.length) {
    throw new Error("当前没有绑定 Mac 执行器的启用账号，请先前往“X 账号/IP”完成绑定。");
  }
  const routableAccounts = assignableAccounts.filter((account) => {
    const proxy = Array.isArray(account.x_reply_account_proxies)
      ? account.x_reply_account_proxies[0]
      : account.x_reply_account_proxies;
    const worker = account.executor_id ? workerByExecutor.get(account.executor_id) : undefined;
    if (!worker) return false;
    return isXAccountClaimEligible({
      executionMode: worker.execution_mode,
      executorId: worker.executor_id ?? "",
      xuseAvailable: worker.xuse_available,
      configuredAccounts: Array.isArray(worker.configured_accounts) ? worker.configured_accounts : [],
      currentEgressIp: worker.current_egress_ip,
      networkProbeStatus: worker.network_probe_status,
      account: {
        executorId: account.executor_id,
        accountKey: account.account_key,
        networkMode: account.network_mode,
        expectedEgressIp: account.expected_egress_ip,
        hasProxy: Boolean(proxy),
        proxyStatus: proxy?.status ?? null,
      },
    });
  });
  // Creating a draft does not send anything. Prefer a currently routable account,
  // but allow preparation to continue while its worker or VPN is temporarily
  // unavailable. Approval and worker claim still repeat the strict route checks.
  const candidateAccounts = routableAccounts.length ? routableAccounts : assignableAccounts;
  const accountIds = candidateAccounts.map((account) => account.id);
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
  const account = [...candidateAccounts].sort((left, right) => (load.get(left.id) ?? 0) - (load.get(right.id) ?? 0))[0];
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
    const { supabase, lead, account } = await getLeadAndAssignedAccount(leadId);
    const { data: existingTask, error: existingTaskError } = await supabase
      .from("x_reply_jobs")
      .select("id")
      .eq("x_lead_id", leadId)
      .maybeSingle();
    if (existingTaskError) throw new Error(existingTaskError.message);
    if (existingTask) return { ok: true };
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
