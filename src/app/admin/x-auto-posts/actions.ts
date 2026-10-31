"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prepareXLeadQueueTask } from "@/lib/x-lead-materials";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getXApprovalBlockReason } from "@/lib/x-reply-safety";

const PAGE_PATH = "/admin/x-auto-posts";
const idSchema = z.string().uuid();

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

export async function approveXAutoDraft(formData: FormData) {
  const user = await requireAdmin(PAGE_PATH);
  const supabase = serviceClient();
  const jobId = idSchema.parse(String(formData.get("jobId") ?? ""));
  const { data: job, error } = await supabase
    .from("x_reply_jobs")
    .select("id,status,account_id,scheduled_for,preparation_status,x_reply_accounts!inner(account_key,positioning,daily_limit,active,executor_id,network_mode,expected_egress_ip,x_reply_account_proxies(account_id,status))")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) throw new Error(error?.message ?? "自动发送草稿不存在。");
  const account = Array.isArray(job.x_reply_accounts) ? job.x_reply_accounts[0] : job.x_reply_accounts;
  const proxyRelation = account?.x_reply_account_proxies;
  const proxy = Array.isArray(proxyRelation) ? proxyRelation[0] : proxyRelation;
  if (!account?.executor_id) throw new Error(getXApprovalBlockReason({
    jobStatus: job.status,
    preparationStatus: job.preparation_status,
    account: account ? { active: account.active, accountKey: account.account_key, executorId: account.executor_id, networkMode: account.network_mode, expectedEgressIp: account.expected_egress_ip, proxyStatus: proxy?.status ?? null } : null,
    worker: null,
    nowMillis: Date.now(),
  }) ?? "账号配置无效。");

  const { data: worker, error: workerError } = await supabase
    .from("x_reply_workers")
    .select("execution_mode,xuse_available,configured_accounts,current_egress_ip,network_probe_status,last_seen_at")
    .eq("executor_id", account.executor_id)
    .gte("last_seen_at", new Date(Date.now() - 5 * 60_000).toISOString())
    .maybeSingle();
  if (workerError) throw new Error(workerError.message);
  const safetyError = getXApprovalBlockReason({
    jobStatus: job.status,
    preparationStatus: job.preparation_status,
    account: { active: account.active, accountKey: account.account_key, executorId: account.executor_id, networkMode: account.network_mode, expectedEgressIp: account.expected_egress_ip, proxyStatus: proxy?.status ?? null },
    worker: worker ? { lastSeenAt: worker.last_seen_at, xuseAvailable: worker.xuse_available, configuredAccounts: Array.isArray(worker.configured_accounts) ? worker.configured_accounts : [], currentEgressIp: worker.current_egress_ip, networkProbeStatus: worker.network_probe_status } : null,
    nowMillis: Date.now(),
  });
  if (safetyError) throw new Error(safetyError);

  const range = shanghaiDayRange(new Date(job.scheduled_for));
  const { count, error: countError } = await supabase
    .from("x_reply_jobs")
    .select("id", { count: "exact", head: true })
    .eq("account_id", job.account_id)
    .in("status", ["queued", "claimed", "sent", "uncertain"])
    .gte("scheduled_for", range.start)
    .lt("scheduled_for", range.end);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) >= account.daily_limit) throw new Error("该账号在计划发送日已达到人工设置的发送上限。");

  const { data: updated, error: updateError } = await supabase
    .from("x_reply_jobs")
    .update({
      status: "queued",
      account_key_snapshot: account.account_key,
      positioning_snapshot: account.positioning,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (updateError || !updated) throw new Error(updateError?.message ?? "任务状态已经变化，请刷新页面。");
  revalidatePath(PAGE_PATH);
  redirect(`${PAGE_PATH}?notice=approved`);
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
    .eq("preparation_status", "failed")
    .maybeSingle();
  if (error || !task?.x_lead_id) throw new Error(error?.message ?? "该任务不能重新生成素材。");
  await supabase.from("x_reply_jobs").update({ preparation_status: "pending", preparation_error: null }).eq("id", taskId);
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
  const { data, error } = await supabase.from("x_reply_daily_gates").update({
    status: "authorized",
    authorized_at: new Date().toISOString(),
    authorized_by: user.id,
  }).eq("account_id", accountId).eq("gate_date", shanghaiToday())
    .eq("status", "awaiting_confirmation").not("first_sent_at", "is", null)
    .select("account_id").maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "今日首条尚未确认发送成功，不能放行后续任务。");
  revalidatePath(PAGE_PATH);
  redirect(`${PAGE_PATH}?notice=daily-authorized`);
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
