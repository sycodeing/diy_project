"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prepareXLeadQueueTask } from "@/lib/x-lead-materials";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const PAGE_PATH = "/admin/x-manual-posts";
const idSchema = z.string().uuid();
const LATTE_ACCOUNT_KEY = "Latte192837465";

function serviceClient() {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端连接尚未配置。");
  return supabase;
}

export async function markXManualPostSentWithoutRefresh(
  _previousState: { ok: boolean; message: string },
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin(PAGE_PATH);
  try {
    const id = idSchema.parse(String(formData.get("id") ?? ""));
    const supabase = serviceClient();
    const sentAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("x_manual_posts")
      .update({ status: "sent", result_url: null, sent_at: sentAt })
      .eq("id", id)
      .eq("status", "draft")
      .select("id,x_lead_id")
      .maybeSingle();
    if (error || !data) return { ok: false, message: error?.message ?? "该手动任务已处理，请手动刷新页面。" };

    if (data.x_lead_id) {
      const { data: lead, error: leadError } = await supabase
        .from("x_leads")
        .select("id,selection_status")
        .eq("id", data.x_lead_id)
        .maybeSingle();
      if (leadError) return { ok: false, message: `发送已登记，但候选状态同步失败：${leadError.message}` };
      if (lead && !["rejected", "suppressed"].includes(lead.selection_status)) {
        const { error: updateLeadError } = await supabase
          .from("x_leads")
          .update({ selection_status: "contacted" })
          .eq("id", lead.id)
          .eq("selection_status", lead.selection_status);
        if (updateLeadError) return { ok: false, message: `发送已登记，但候选状态同步失败：${updateLeadError.message}` };
      }
    }

    // Deliberately avoid revalidatePath/redirect. The client keeps the current
    // queue order and only a manual browser refresh applies the status-based sort.
    return { ok: true, message: "已登记人工发送。当前页面顺序保持不变，手动刷新后才会调整排序。" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "登记发送结果失败。" };
  }
}

export async function discardXManualDraft(formData: FormData) {
  await requireAdmin(PAGE_PATH);
  const id = idSchema.parse(String(formData.get("id") ?? ""));
  const { data, error } = await serviceClient()
    .from("x_manual_posts")
    .update({
      status: "discarded",
      preview_download_status: "idle",
      preview_download_worker_id: null,
      preview_download_error: null,
    })
    .eq("id", id)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "该手动任务已处理，请刷新页面。");
  revalidatePath(PAGE_PATH);
  redirect(`${PAGE_PATH}?notice=discarded`);
}

export async function retryXManualPreparation(formData: FormData) {
  await requireAdmin(PAGE_PATH);
  const taskId = idSchema.parse(String(formData.get("id") ?? ""));
  const supabase = serviceClient();
  const { data: task, error } = await supabase
    .from("x_manual_posts")
    .select("id,x_lead_id,preparation_status")
    .eq("id", taskId)
    .eq("preparation_status", "failed")
    .maybeSingle();
  if (error || !task?.x_lead_id) throw new Error(error?.message ?? "该任务不能重新生成素材。");
  await supabase.from("x_manual_posts").update({ preparation_status: "pending", preparation_error: null }).eq("id", taskId);
  after(() => prepareXLeadQueueTask({ queue: "manual", taskId, leadId: task.x_lead_id }));
  revalidatePath(PAGE_PATH);
}

export async function requestLatteManualPostWindow(formData: FormData) {
  await requireAdmin(PAGE_PATH);
  const taskId = idSchema.parse(String(formData.get("id") ?? ""));
  const supabase = serviceClient();
  const { data: task, error: taskError } = await supabase.from("x_manual_posts")
    .select("id,status,action_type,target_post_url,result_url,preparation_status,bound_open_status")
    .eq("id", taskId).maybeSingle();
  if (taskError || !task) throw new Error(taskError?.message ?? "手动发送任务不存在。");
  if (task.status === "discarded" || (task.status === "draft" && task.preparation_status !== "ready")) {
    throw new Error("只有素材准备完成的待发送任务或已发送记录可以打开 Latte 绑定窗口。");
  }
  if (["pending", "running"].includes(task.bound_open_status)) {
    redirect(`${PAGE_PATH}?notice=latte-window-active`);
  }

  const { data: account, error: accountError } = await supabase.from("x_reply_accounts")
    .select("id,account_key,active,executor_id,network_mode,expected_egress_ip,verification_status,x_reply_account_proxies(status,egress_ip)")
    .eq("account_key", LATTE_ACCOUNT_KEY).maybeSingle();
  if (accountError || !account?.active || !account.executor_id) {
    throw new Error(accountError?.message ?? "Latte 账号未启用或未绑定执行器。");
  }
  if (account.verification_status !== "passed") throw new Error("Latte 账号尚未通过账号与出口映射验证。");
  const proxyRelation = account.x_reply_account_proxies;
  const proxy = Array.isArray(proxyRelation) ? proxyRelation[0] : proxyRelation;
  if (account.network_mode === "fixed_proxy" && (proxy?.status !== "healthy" || !proxy.egress_ip)) {
    throw new Error("Latte 的固定代理尚未确认健康出口。");
  }
  const { data: worker, error: workerError } = await supabase.from("x_reply_workers")
    .select("xuse_available,configured_accounts,current_egress_ip,network_probe_status,last_seen_at")
    .eq("executor_id", account.executor_id)
    .gte("last_seen_at", new Date(Date.now() - 5 * 60_000).toISOString())
    .maybeSingle();
  if (workerError || !worker) throw new Error(workerError?.message ?? "绑定的 Mac 执行器不在线。");
  if (!worker.xuse_available || !worker.configured_accounts.includes(LATTE_ACCOUNT_KEY)) {
    throw new Error("绑定执行器缺少 Latte 的本地 x-use 登录数据。");
  }
  if (account.network_mode === "vpn_direct"
    && (!account.expected_egress_ip || worker.network_probe_status !== "healthy"
      || String(account.expected_egress_ip) !== String(worker.current_egress_ip ?? ""))) {
    throw new Error("当前 VPN 出口与 Latte 锁定的出口不一致。");
  }

  const resultUrl = task.result_url && /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/[0-9]+$/i.test(task.result_url)
    ? task.result_url
    : null;
  const targetUrl = task.status === "sent"
    ? resultUrl ?? task.target_post_url
    : task.action_type === "post" ? "https://x.com/compose/post" : task.target_post_url;
  if (!targetUrl || (targetUrl !== "https://x.com/compose/post"
    && !/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/[0-9]+$/i.test(targetUrl))) {
    throw new Error("该手动任务没有有效的 X 目标链接。");
  }
  const requestedAt = new Date().toISOString();
  const { data: updated, error } = await supabase.from("x_manual_posts").update({
    account_id: account.id,
    bound_open_status: "pending",
    bound_open_target_url: targetUrl,
    bound_open_executor_id: null,
    bound_open_requested_at: requestedAt,
    bound_open_started_at: null,
    bound_open_completed_at: null,
    bound_open_error: null,
  }).eq("id", task.id).in("status", ["draft", "sent"])
    .in("bound_open_status", ["idle", "completed", "failed"])
    .select("id").maybeSingle();
  if (error || !updated) throw new Error(error?.message ?? "打开请求状态已经变化，请刷新页面后重试。");
  revalidatePath(PAGE_PATH);
  redirect(`${PAGE_PATH}?notice=latte-window-requested`);
}
