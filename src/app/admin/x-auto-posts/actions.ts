"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prepareXLeadQueueTask } from "@/lib/x-lead-materials";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const PAGE_PATH = "/admin/x-auto-posts";
const idSchema = z.string().uuid();
const actionTypeSchema = z.enum(["post", "reply"]);
const xPostUrlSchema = z.string().trim().url().max(2048).refine(
  (value) => /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/i.test(value),
  "请输入具体的 X 帖子链接。",
);
const shanghaiDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

function serviceClient() {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端连接尚未配置。");
  return supabase;
}

function parseShanghaiDateTime(value: FormDataEntryValue | null) {
  const localValue = shanghaiDateTimeSchema.parse(String(value ?? ""));
  const result = new Date(`${localValue}:00+08:00`);
  if (!Number.isFinite(result.getTime())) throw new Error("计划发送时间无效。");
  const now = Date.now();
  if (result.getTime() < now - 10 * 60_000) throw new Error("计划发送时间不能早于当前时间 10 分钟以上。");
  if (result.getTime() > now + 31 * 24 * 60 * 60_000) throw new Error("计划发送时间最多可设置到 31 天后。");
  return result;
}

function shanghaiDayRange(value: Date) {
  const local = new Date(value.getTime() + 8 * 60 * 60_000);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 8 * 60 * 60_000;
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 24 * 60 * 60_000).toISOString(),
  };
}

export async function createXAutoDraft(formData: FormData) {
  const user = await requireAdmin(PAGE_PATH);
  const supabase = serviceClient();
  const accountId = idSchema.parse(String(formData.get("accountId") ?? ""));
  const actionType = actionTypeSchema.parse(String(formData.get("actionType") ?? ""));
  const scheduledFor = parseShanghaiDateTime(formData.get("scheduledFor"));
  const { data: account, error: accountError } = await supabase
    .from("x_reply_accounts")
    .select("id,active")
    .eq("id", accountId)
    .maybeSingle();
  if (accountError || !account) throw new Error(accountError?.message ?? "账号不存在。");
  if (!account.active) throw new Error("该账号已停用，不能创建自动发送草稿。");

  const targetValue = String(formData.get("targetPostUrl") ?? "").trim();
  const targetPostUrl = actionType === "reply" ? xPostUrlSchema.parse(targetValue) : null;
  const { error } = await supabase.from("x_reply_jobs").insert({
    account_id: accountId,
    action_type: actionType,
    target_post_url: targetPostUrl,
    reply_text: z.string().trim().min(1).max(270).parse(String(formData.get("postText") ?? "")),
    scheduled_for: scheduledFor.toISOString(),
    status: "draft",
    created_by: user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath(PAGE_PATH);
  redirect(`${PAGE_PATH}?notice=draft-created`);
}

export async function approveXAutoDraft(formData: FormData) {
  const user = await requireAdmin(PAGE_PATH);
  const supabase = serviceClient();
  const jobId = idSchema.parse(String(formData.get("jobId") ?? ""));
  const { data: job, error } = await supabase
    .from("x_reply_jobs")
    .select("id,status,account_id,scheduled_for,preparation_status,x_reply_accounts!inner(account_key,positioning,daily_limit,active,bitbrowser_window_id,x_reply_account_proxies(account_id,status))")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) throw new Error(error?.message ?? "自动发送草稿不存在。");
  if (job.status !== "draft") throw new Error("该任务已经处理，不能重复批准。");
  if (job.preparation_status !== "ready") throw new Error("预览图、链接和文案尚未准备完成，暂不能批准发送。");
  const account = Array.isArray(job.x_reply_accounts) ? job.x_reply_accounts[0] : job.x_reply_accounts;
  if (!account?.active) throw new Error("该账号已停用。");
  if (!account.bitbrowser_window_id) throw new Error("该账号尚未绑定比特浏览器窗口。");
  const proxy = Array.isArray(account.x_reply_account_proxies) ? account.x_reply_account_proxies[0] : account.x_reply_account_proxies;
  if (!proxy) throw new Error("该账号尚未配置固定代理，请先到 X 账号/IP 页面设置。");
  if (proxy.status === "error") throw new Error("该账号的固定代理处于异常状态，请更换或重新保存后再批准。");

  const { data: workers } = await supabase
    .from("x_reply_workers")
    .select("bitbrowser_windows,last_seen_at,bitbrowser_available")
    .eq("bitbrowser_available", true)
    .gte("last_seen_at", new Date(Date.now() - 5 * 60_000).toISOString());
  const locallyConfigured = (workers ?? []).some((worker) => Array.isArray(worker.bitbrowser_windows)
    && worker.bitbrowser_windows.some((window) => window && typeof window === "object" && "id" in window && window.id === account.bitbrowser_window_id));
  if (!locallyConfigured) throw new Error(`本机比特浏览器尚未报告窗口 ${account.bitbrowser_window_id}，请确认客户端和 Worker 都已启动。`);

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
