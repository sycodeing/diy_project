"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prepareXLeadQueueTask } from "@/lib/x-lead-materials";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getXApprovalBlockReason, getXPausedGateResumeStatus, supportsXFirstContactWorker } from "@/lib/x-reply-safety";

const PAGE_PATH = "/admin/x-auto-posts";
const idSchema = z.string().uuid();
const batchIdsSchema = z.array(idSchema).min(1).max(100);
const xStatusUrlSchema = z.string().url().max(2048)
  .refine((value) => /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/[0-9]+/i.test(value));

export type XAutoApprovalResult =
  | { ok: true; approvedCount: number }
  | { ok: false; error: string };

class XAutoApprovalError extends Error {}

function serviceClient() {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端连接尚未配置。");
  return supabase;
}

function shanghaiDayRange(value: Date) {
  const local = new Date(value.getTime() + 8 * 60 * 60_000);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 8 * 60 * 60_000;
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 24 * 60 * 60_000).toISOString(),
  };
}

export async function approveXAutoDraft(formData: FormData): Promise<XAutoApprovalResult> {
  const user = await requireAdmin(PAGE_PATH);
  try {
    const jobId = idSchema.parse(String(formData.get("jobId") ?? ""));
    const approvedCount = await approveXAutoJobs([jobId], user.id);
    revalidatePath(PAGE_PATH);
    return { ok: true, approvedCount };
  } catch (error) {
    return approvalFailure(error, "批准失败，请刷新页面后重试。");
  }
}

export async function approveXAutoBatch(formData: FormData): Promise<XAutoApprovalResult> {
  const user = await requireAdmin(PAGE_PATH);
  try {
    const jobIds = batchIdsSchema.parse(formData.getAll("jobId").map(String));
    const approvedCount = await approveXAutoJobs(jobIds, user.id);
    revalidatePath(PAGE_PATH);
    return { ok: true, approvedCount };
  } catch (error) {
    return approvalFailure(error, "批量批准失败，请刷新页面后重试。");
  }
}

export async function startAllXAutoSending(): Promise<XAutoApprovalResult> {
  const user = await requireAdmin(PAGE_PATH);
  try {
    const supabase = serviceClient();
    const { count: preparingCount, error: preparingError } = await supabase
      .from("x_reply_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft")
      .in("preparation_status", ["pending", "processing"]);
    if (preparingError) throw new Error(preparingError.message);
    if ((preparingCount ?? 0) > 0) {
      throw new XAutoApprovalError("仍有自动任务正在生成素材，请等待全部准备完成后再开始发送。");
    }
    const approvedCount = await approveXAutoJobs(null, user.id);
    revalidatePath(PAGE_PATH);
    return { ok: true, approvedCount };
  } catch (error) {
    return approvalFailure(error, "开始全部发送失败，请刷新页面后重试。");
  }
}

export async function stopXAutoBatch(formData: FormData) {
  await requireAdmin(PAGE_PATH);
  const approvedAt = z.string().datetime({ offset: true }).parse(String(formData.get("approvedAt") ?? ""));
  const supabase = serviceClient();
  const { error } = await supabase.from("x_reply_jobs").update({
    status: "rejected",
    completed_at: new Date().toISOString(),
    error_code: "batch_stopped",
    error_message: "管理员已立即停止本批发送；任务未下发到 X。",
  }).eq("approved_at", approvedAt).eq("status", "queued");
  if (error) throw new Error(error.message);
  revalidatePath(PAGE_PATH);
  redirect(`${PAGE_PATH}?notice=batch-stopped`);
}

function approvalFailure(error: unknown, fallback: string): XAutoApprovalResult {
  if (error instanceof z.ZodError) {
    return { ok: false, error: "请至少勾选一条已就绪的草稿，单次最多选择 100 条。" };
  }
  if (error instanceof XAutoApprovalError) return { ok: false, error: error.message };
  console.error("X auto approval failed", error);
  return { ok: false, error: fallback };
}

async function approveXAutoJobs(requestedJobIds: string[] | null, userId: string) {
  const supabase = serviceClient();
  const jobIds = requestedJobIds ? [...new Set(requestedJobIds)] : null;
  let jobsQuery = supabase
    .from("x_reply_jobs")
    .select("id,status,account_id,content_mode,scheduled_for,preparation_status,x_reply_accounts!inner(account_key,positioning,daily_limit,active,executor_id,network_mode,expected_egress_ip,verification_status,x_reply_account_proxies(account_id,status))");
  jobsQuery = jobIds
    ? jobsQuery.in("id", jobIds)
    : jobsQuery.eq("status", "draft").eq("preparation_status", "ready").order("created_at", { ascending: true });
  const { data: jobs, error } = await jobsQuery;
  if (error) throw new Error(error.message);
  if (!jobs?.length) throw new XAutoApprovalError("当前没有已就绪、等待开始的自动任务。");
  if (jobIds && jobs.length !== jobIds.length) throw new XAutoApprovalError("部分自动发送草稿不存在，请刷新页面后重试。");

  const executorIds = [...new Set(jobs.flatMap((job) => {
    const account = Array.isArray(job.x_reply_accounts) ? job.x_reply_accounts[0] : job.x_reply_accounts;
    return account?.executor_id ? [account.executor_id] : [];
  }))];
  const { data: workers, error: workerError } = executorIds.length
    ? await supabase
      .from("x_reply_workers")
      .select("executor_id,worker_version,execution_mode,xuse_available,configured_accounts,current_egress_ip,network_probe_status,last_seen_at")
      .in("executor_id", executorIds)
      .gte("last_seen_at", new Date(Date.now() - 5 * 60_000).toISOString())
    : { data: [], error: null };
  if (workerError) throw new Error(workerError.message);
  const approvedAt = new Date();
  const range = shanghaiDayRange(approvedAt);
  const workersByExecutor = new Map((workers ?? []).map((worker) => [worker.executor_id, worker]));
  const groups = new Map<string, {
    accountKey: string;
    positioning: string;
    dailyLimit: number;
    jobIds: string[];
  }>();

  for (const job of jobs) {
    const account = Array.isArray(job.x_reply_accounts) ? job.x_reply_accounts[0] : job.x_reply_accounts;
    const proxyRelation = account?.x_reply_account_proxies;
    const proxy = Array.isArray(proxyRelation) ? proxyRelation[0] : proxyRelation;
    const worker = account?.executor_id ? workersByExecutor.get(account.executor_id) : null;
    const safetyError = getXApprovalBlockReason({
      jobStatus: job.status,
      preparationStatus: job.preparation_status,
      account: account ? { active: account.active, accountKey: account.account_key, executorId: account.executor_id, networkMode: account.network_mode, expectedEgressIp: account.expected_egress_ip, verificationStatus: account.verification_status, proxyStatus: proxy?.status ?? null } : null,
      worker: worker ? { lastSeenAt: worker.last_seen_at, xuseAvailable: worker.xuse_available, configuredAccounts: Array.isArray(worker.configured_accounts) ? worker.configured_accounts : [], currentEgressIp: worker.current_egress_ip, networkProbeStatus: worker.network_probe_status } : null,
      nowMillis: approvedAt.getTime(),
    });
    if (safetyError) throw new XAutoApprovalError(safetyError);
    if (job.content_mode === "first_contact_text" && !supportsXFirstContactWorker(worker?.worker_version)) {
      throw new XAutoApprovalError("首条纯文字接触需要先升级并重启本机执行器至 4.8.0 或更新版本。");
    }
    if (!account || worker?.execution_mode !== "send") throw new XAutoApprovalError("绑定的 Mac Worker 当前不是发送模式。");
    const group = groups.get(job.account_id) ?? {
      accountKey: account.account_key,
      positioning: account.positioning,
      dailyLimit: account.daily_limit,
      jobIds: [] as string[],
    };
    group.jobIds.push(job.id);
    groups.set(job.account_id, group);
  }

  for (const [accountId, group] of groups) {
    const { count, error: countError } = await supabase
      .from("x_reply_jobs")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .in("status", ["queued", "claimed", "sent", "uncertain"])
      .gte("scheduled_for", range.start)
      .lt("scheduled_for", range.end);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) + group.jobIds.length > group.dailyLimit) {
      throw new XAutoApprovalError(`${group.accountKey} 的所选任务会超过今日发送上限。`);
    }
  }

  for (const group of groups.values()) {
    const { data: updated, error: updateError } = await supabase
      .from("x_reply_jobs")
      .update({
        status: "queued",
        account_key_snapshot: group.accountKey,
        positioning_snapshot: group.positioning,
        approved_by: userId,
        approved_at: approvedAt.toISOString(),
        scheduled_for: approvedAt.toISOString(),
      })
      .in("id", group.jobIds)
      .eq("status", "draft")
      .eq("preparation_status", "ready")
      .select("id");
    if (updateError || updated?.length !== group.jobIds.length) {
      if (updateError) throw new Error(updateError.message);
      throw new XAutoApprovalError("部分任务状态已经变化，请刷新页面后重试。");
    }
  }
  return jobs.length;
}

export async function rejectXAutoDraft(formData: FormData) {
  await requireAdmin(PAGE_PATH);
  const jobId = idSchema.parse(String(formData.get("jobId") ?? ""));
  const { error } = await serviceClient()
    .from("x_reply_jobs")
    .update({ status: "rejected", completed_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "draft");
  if (error) throw new Error(error.message);
  revalidatePath(PAGE_PATH);
}

export async function retryXAutoPreparation(formData: FormData) {
  await requireAdmin(PAGE_PATH);
  const taskId = idSchema.parse(String(formData.get("jobId") ?? ""));
  const supabase = serviceClient();
  const { data: task, error } = await supabase
    .from("x_reply_jobs")
    .select("id,x_lead_id,preparation_status")
    .eq("id", taskId)
    .eq("status", "draft").eq("attempt_count", 0).is("approved_at", null)
    .in("preparation_status", ["failed", "ready"])
    .maybeSingle();
  if (error || !task?.x_lead_id) throw new Error(error?.message ?? "该任务不能重新生成素材。");
  const { data: reset, error: resetError } = await supabase.from("x_reply_jobs").update({
    preparation_status: "pending", preparation_error: null, content_mode: "first_contact_text",
  }).eq("id", taskId).eq("status", "draft").eq("attempt_count", 0).is("approved_at", null)
    .eq("preparation_status", task.preparation_status).select("id").maybeSingle();
  if (resetError || !reset) throw new Error(resetError?.message ?? "任务状态已经变化，未修改文案。");
  after(() => prepareXLeadQueueTask({ queue: "automatic", taskId, leadId: task.x_lead_id }));
  revalidatePath(PAGE_PATH);
}

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function authorizeXDailySending(formData: FormData) {
  const user = await requireAdmin(PAGE_PATH);
  const accountId = idSchema.parse(String(formData.get("accountId") ?? ""));
  const supabase = serviceClient();
  const { data: gate, error: gateError } = await supabase.from("x_reply_daily_gates")
    .select("first_job_id")
    .eq("account_id", accountId).eq("gate_date", shanghaiToday())
    .eq("status", "awaiting_confirmation").not("first_sent_at", "is", null)
    .maybeSingle();
  if (gateError || !gate?.first_job_id) {
    throw new Error(gateError?.message ?? "今日首条尚未确认发送成功，不能放行后续任务。");
  }
  const { data, error } = await supabase.from("x_reply_daily_gates").update({
    status: "authorized",
    authorized_at: new Date().toISOString(),
    authorized_by: user.id,
  }).eq("account_id", accountId).eq("gate_date", shanghaiToday()).eq("first_job_id", gate.first_job_id)
    .eq("status", "awaiting_confirmation").not("first_sent_at", "is", null)
    .select("account_id").maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "今日首条尚未确认发送成功，不能放行后续任务。");
  revalidatePath(PAGE_PATH);
  redirect(`${PAGE_PATH}?notice=daily-authorized`);
}

export async function requestBoundXJobInspection(formData: FormData) {
  await requireAdmin(PAGE_PATH);
  const jobId = idSchema.parse(String(formData.get("jobId") ?? ""));
  const supabase = serviceClient();
  const { data: job, error: jobError } = await supabase.from("x_reply_jobs")
    .select("id,result_url,target_post_url,inspection_status,x_reply_accounts!inner(account_key,active,executor_id,network_mode,expected_egress_ip,verification_status,x_reply_account_proxies(status,egress_ip))")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError || !job) throw new Error(jobError?.message ?? "自动任务不存在。");
  if (["pending", "running"].includes(job.inspection_status)) {
    redirect(`${PAGE_PATH}?notice=inspection-already-active`);
  }
  const account = Array.isArray(job.x_reply_accounts) ? job.x_reply_accounts[0] : job.x_reply_accounts;
  if (!account?.active || !account.executor_id) throw new Error("该任务的 X 账号未启用或未绑定执行器。");
  if (account.verification_status !== "passed") throw new Error("该账号尚未通过账号与出口映射验证。");
  const proxyRelation = account.x_reply_account_proxies;
  const proxy = Array.isArray(proxyRelation) ? proxyRelation[0] : proxyRelation;
  if (account.network_mode === "fixed_proxy" && (proxy?.status !== "healthy" || !proxy.egress_ip)) {
    throw new Error("该账号的固定代理尚未确认健康出口。");
  }
  const { data: worker, error: workerError } = await supabase.from("x_reply_workers")
    .select("execution_mode,xuse_available,configured_accounts,current_egress_ip,network_probe_status,last_seen_at")
    .eq("executor_id", account.executor_id)
    .gte("last_seen_at", new Date(Date.now() - 5 * 60_000).toISOString())
    .maybeSingle();
  if (workerError || !worker) throw new Error(workerError?.message ?? "绑定的 Mac 执行器不在线。");
  if (!worker.xuse_available || !worker.configured_accounts.includes(account.account_key)) {
    throw new Error("绑定执行器缺少该账号的本地 x-use 登录数据。");
  }
  if (account.network_mode === "vpn_direct"
    && (!account.expected_egress_ip || worker.network_probe_status !== "healthy"
      || String(account.expected_egress_ip) !== String(worker.current_egress_ip ?? ""))) {
    throw new Error("当前 VPN 出口与该账号锁定的出口不一致。");
  }
  const resultTarget = xStatusUrlSchema.safeParse(job.result_url);
  const sourceTarget = xStatusUrlSchema.safeParse(job.target_post_url);
  const targetUrl = resultTarget.success ? resultTarget.data : sourceTarget.success ? sourceTarget.data : null;
  if (!targetUrl) throw new Error("该自动任务没有可通过绑定 IP 打开的 X 帖子链接。");
  const requestedAt = new Date().toISOString();
  const { data: updated, error } = await supabase.from("x_reply_jobs").update({
    inspection_status: "pending",
    inspection_target_url: targetUrl,
    inspection_executor_id: null,
    inspection_requested_at: requestedAt,
    inspection_started_at: null,
    inspection_completed_at: null,
    inspection_error: null,
  }).eq("id", job.id).in("inspection_status", ["idle", "completed", "failed"])
    .select("id").maybeSingle();
  if (error || !updated) throw new Error(error?.message ?? "打开请求状态已经变化，请刷新页面后重试。");
  revalidatePath(PAGE_PATH);
  redirect(`${PAGE_PATH}?notice=inspection-requested`);
}

export async function resumeXDailySendingAfterUncertainReview(formData: FormData) {
  const user = await requireAdmin(PAGE_PATH);
  const accountId = idSchema.parse(String(formData.get("accountId") ?? ""));
  const supabase = serviceClient();
  const { data: gate, error: gateError } = await supabase.from("x_reply_daily_gates")
    .select("first_job_id,status")
    .eq("account_id", accountId)
    .eq("gate_date", shanghaiToday())
    .eq("status", "paused")
    .maybeSingle();
  if (gateError || !gate?.first_job_id) {
    throw new Error(gateError?.message ?? "今日暂停状态已经变化，请刷新页面后重试。");
  }
  const { data: firstJob, error: jobError } = await supabase.from("x_reply_jobs")
    .select("id")
    .eq("id", gate.first_job_id)
    .eq("account_id", accountId)
    .eq("status", "uncertain")
    .maybeSingle();
  if (jobError || !firstJob) {
    throw new Error(jobError?.message ?? "只有结果不确定的今日首条才能放行剩余任务。");
  }
  const { data, error } = await supabase.from("x_reply_daily_gates").update({
    status: "authorized",
    authorized_at: new Date().toISOString(),
    authorized_by: user.id,
  }).eq("account_id", accountId).eq("gate_date", shanghaiToday())
    .eq("status", "paused").eq("first_job_id", firstJob.id)
    .select("account_id").maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "今日暂停状态已经变化，请刷新页面后重试。");
  revalidatePath(PAGE_PATH);
  redirect(`${PAGE_PATH}?notice=daily-reviewed-continue`);
}

export async function retryUnsentXAutoJob(formData: FormData) {
  await requireAdmin(PAGE_PATH);
  const jobId = idSchema.parse(String(formData.get("jobId") ?? ""));
  const supabase = serviceClient();
  const { data: job, error: readError } = await supabase.from("x_reply_jobs")
    .select("id,status,action_id,account_id,error_code")
    .eq("id", jobId).maybeSingle();
  if (readError || !job || job.status !== "uncertain" || !job.action_id) {
    throw new Error(readError?.message ?? "只有带 x-use 操作记录的结果不确定任务可以单条重试。");
  }
  const { data: updated, error } = await supabase.from("x_reply_jobs").update({
    status: "queued",
    attempt_count: 0,
    scheduled_for: new Date().toISOString(),
    claimed_at: null,
    completed_at: null,
    worker_id: null,
    error_code: "manual_retry_not_sent",
    error_message: "管理员确认 X 上未发出；本机将先对账原操作，再仅重试此条。",
  }).eq("id", jobId).eq("status", "uncertain").eq("action_id", job.action_id)
    .select("id").maybeSingle();
  if (error || !updated) throw new Error(error?.message ?? "任务状态已变化，请刷新页面后重试。");
  revalidatePath(PAGE_PATH);
  redirect(`${PAGE_PATH}?notice=single-retry-queued`);
}

export async function pauseXDailySending(formData: FormData) {
  await requireAdmin(PAGE_PATH);
  const accountId = idSchema.parse(String(formData.get("accountId") ?? ""));
  const { error } = await serviceClient().from("x_reply_daily_gates").upsert({
    account_id: accountId,
    gate_date: shanghaiToday(),
    status: "paused",
    authorized_at: null,
    authorized_by: null,
  }, { onConflict: "account_id,gate_date" });
  if (error) throw new Error(error.message);
  revalidatePath(PAGE_PATH);
  redirect(`${PAGE_PATH}?notice=daily-paused`);
}

export async function resumePausedXDailySending(formData: FormData) {
  const user = await requireAdmin(PAGE_PATH);
  const accountId = idSchema.parse(String(formData.get("accountId") ?? ""));
  const supabase = serviceClient();
  const today = shanghaiToday();
  const { data: gate, error: gateError } = await supabase.from("x_reply_daily_gates")
    .select("first_job_id,status,first_sent_at")
    .eq("account_id", accountId).eq("gate_date", today).eq("status", "paused")
    .maybeSingle();
  if (gateError || !gate) throw new Error(gateError?.message ?? "该账号今天已不是暂停状态，请刷新页面。");

  const [{ data: firstJob, error: jobError }, { count: activeCount, error: activeError }] = await Promise.all([
    gate.first_job_id
      ? supabase.from("x_reply_jobs").select("id,status").eq("id", gate.first_job_id).eq("account_id", accountId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("x_reply_jobs").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("status", "claimed"),
  ]);
  if (jobError || activeError) throw new Error(jobError?.message ?? activeError?.message);
  if ((activeCount ?? 0) > 0) throw new Error("该账号仍有任务正在执行，请等待其完成后再恢复。");
  const nextStatus = getXPausedGateResumeStatus(firstJob?.status ?? null);
  if (!nextStatus) throw new Error("今日首条结果尚不确定，请使用对应的核对或单条重试入口。");

  const now = new Date().toISOString();
  let update = supabase.from("x_reply_daily_gates").update({
    status: nextStatus,
    first_job_id: nextStatus === "pending" ? null : gate.first_job_id,
    first_sent_at: nextStatus === "pending" ? null : gate.first_sent_at,
    authorized_at: nextStatus === "authorized" ? now : null,
    authorized_by: nextStatus === "authorized" ? user.id : null,
  }).eq("account_id", accountId).eq("gate_date", today).eq("status", "paused");
  update = gate.first_job_id ? update.eq("first_job_id", gate.first_job_id) : update.is("first_job_id", null);
  const { data: resumed, error } = await update.select("account_id").maybeSingle();
  if (error || !resumed) throw new Error(error?.message ?? "暂停状态已变化，请刷新页面后重试。");
  revalidatePath(PAGE_PATH);
  redirect(`${PAGE_PATH}?notice=daily-resumed`);
}
