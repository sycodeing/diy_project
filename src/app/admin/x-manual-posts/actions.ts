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
const xPostUrlSchema = z.string().trim().url().max(2048).refine(
  (value) => /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/i.test(value),
  "请输入具体的 X 帖子链接。",
);

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
    const resultValue = String(formData.get("resultUrl") ?? "").trim();
    const resultUrl = resultValue ? xPostUrlSchema.parse(resultValue) : null;
    const supabase = serviceClient();
    const sentAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("x_manual_posts")
      .update({ status: "sent", result_url: resultUrl, sent_at: sentAt })
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
