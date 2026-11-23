"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getXApprovalBlockReason } from "@/lib/x-reply-safety";
import { hasPriorXContact, supportsXReplyV2PreviewWorker, supportsXReplyV2Worker, validateV2Snapshot, type V2Snapshot } from "@/lib/x-reply-v2";

const PATH = "/admin/x-auto-posts-v2";
const id = /^[0-9a-f-]{36}$/i;
const authorId = /^\d{5,30}$/;
export type V2ActionState = { ok: number; failed: Array<{ id: string; reason: string }> };
const EMPTY: V2ActionState = { ok: 0, failed: [] };

function db() {
  const client = getSupabaseServiceClient();
  if (!client) throw new Error("数据库连接不可用");
  return client;
}
function selected(formData: FormData, field: string, pattern: RegExp) {
  return [...new Set(formData.getAll(field).map(String).filter((value) => pattern.test(value)))].slice(0, 100);
}
function finish(state: V2ActionState) { revalidatePath(PATH); revalidatePath("/admin/x-leads"); return state; }

/** Adds an unapproved snapshot only. Each selection has its own visible failure reason. */
export async function addV2Drafts(_previous: V2ActionState = EMPTY, formData: FormData): Promise<V2ActionState> {
  void _previous;
  const admin = await requireAdmin(PATH);
  const ids = selected(formData, "authorId", authorId);
  const accountId = String(formData.get("accountId") ?? "");
  if (!id.test(accountId)) return { ok: 0, failed: [{ id: "account", reason: "请选择发送账号。" }] };
  if (!ids.length) return { ok: 0, failed: [{ id: "selection", reason: "请先选择账号草稿。" }] };
  const supabase = db();
  const result: V2ActionState = { ok: 0, failed: [] };
  const { data: sender, error: senderError } = await supabase.from("x_reply_accounts")
    .select("id,active").eq("id", accountId).maybeSingle();
  if (senderError || !sender?.active) return { ok: 0, failed: [{ id: "account", reason: "发送账号已停用或不可读。" }] };
  for (const author of ids) {
    try {
      const [{ data: draft, error: draftError }, { data: account, error: accountError }] = await Promise.all([
        supabase.from("x_lead_account_drafts")
          .select("author_id,status,selected_post_id,reply_text,marketing_link_id,generated_at,product_slug,product_match_reason,preview_status,artwork_path,artwork_hash,preview_path,preview_hash,preview_template_id")
          .eq("author_id", author).maybeSingle(),
        supabase.from("x_lead_account_reviews")
          .select("author_id,x_handle").eq("author_id", author).maybeSingle(),
      ]);
      if (draftError || accountError || !draft || !account || draft.status !== "draft_ready"
        || !draft.selected_post_id || !draft.marketing_link_id || !draft.reply_text) throw new Error("可用账号草稿不存在。" );
      const handle = String(account.x_handle ?? "").replace(/^@/, "");
      if (!/^[A-Za-z0-9_]{1,50}$/.test(handle)) throw new Error("账号 X handle 无效。" );
      const withPreview = draft.preview_status === "ready";
      const snapshot: V2Snapshot = { queue_version: 2, content_mode: withPreview ? "account_product_preview" : "account_product_link",
        target_author_id: author, account_draft_author_id: author, marketing_link_id: draft.marketing_link_id,
        source_post_id: draft.selected_post_id, draft_generated_at: draft.generated_at,
        target_post_url: `https://x.com/${handle}/status/${draft.selected_post_id}`, reply_text: draft.reply_text,
        account_artwork_path: withPreview ? draft.artwork_path : null,
        account_artwork_hash: withPreview ? draft.artwork_hash : null,
        account_preview_path: withPreview ? draft.preview_path : null,
        account_preview_hash: withPreview ? draft.preview_hash : null,
        account_preview_template_id: withPreview ? draft.preview_template_id : null };
      const reason = await validateV2Snapshot(supabase, snapshot);
      if (reason) throw new Error(reason);
      if (await hasPriorXContact(supabase, author, handle, draft.selected_post_id)) throw new Error("历史已联系或已屏蔽。" );
      const { error } = await supabase.from("x_reply_jobs").insert({ ...snapshot,
        account_id: accountId, action_type: "reply", status: "draft", preparation_status: "ready",
        scheduled_for: new Date().toISOString(), approved_at: null, approved_by: null,
        created_by: admin.id, copy_variant: withPreview ? "account_preview_v1" : "account_context_v2",
        product_slug_snapshot: draft.product_slug,
        product_match_reason_snapshot: draft.product_match_reason,
      });
      if (error) throw new Error(error.code === "23505" ? "该作者已在 V2 队列或已有发送记录。" : error.message);
      result.ok++;
    } catch (error) { result.failed.push({ id: author, reason: error instanceof Error ? error.message : "加入失败" }); }
  }
  return finish(result);
}

/** Approval is separate from queue creation; never approves rows not explicitly selected. */
export async function approveV2Drafts(_previous: V2ActionState = EMPTY, formData: FormData): Promise<V2ActionState> {
  void _previous;
  const admin = await requireAdmin(PATH);
  const ids = selected(formData, "jobId", id);
  if (!ids.length) return { ok: 0, failed: [{ id: "selection", reason: "请选择待审队列任务。" }] };
  const supabase = db();
  const now = new Date();
  const result: V2ActionState = { ok: 0, failed: [] };
  for (const jobId of ids) {
    try {
      const { data: job, error: readError } = await supabase.from("x_reply_jobs")
        .select("id,queue_version,content_mode,target_author_id,account_draft_author_id,marketing_link_id,source_post_id,draft_generated_at,target_post_url,reply_text,account_artwork_path,account_artwork_hash,account_preview_path,account_preview_hash,account_preview_template_id,status,preparation_status,account_id,x_reply_accounts!inner(account_key,positioning,daily_limit,active,executor_id,network_mode,expected_egress_ip,verification_status,x_reply_account_proxies(status))")
        .eq("id", jobId).eq("queue_version", 2).maybeSingle();
      if (readError || !job) throw new Error("V2 任务不存在。" );
      if (job.status !== "draft" || job.preparation_status !== "ready") throw new Error("任务已经处理或未就绪。" );
      const account = Array.isArray(job.x_reply_accounts) ? job.x_reply_accounts[0] : job.x_reply_accounts;
      if (!account?.executor_id) throw new Error("发送账号尚未绑定执行器。" );
      const { data: worker, error: workerError } = await supabase.from("x_reply_workers")
        .select("worker_version,execution_mode,xuse_available,configured_accounts,current_egress_ip,network_probe_status,last_seen_at")
        .eq("executor_id", account.executor_id).maybeSingle();
      if (workerError) throw new Error("执行器状态不可读。" );
      const proxyRelation = account.x_reply_account_proxies;
      const proxy = Array.isArray(proxyRelation) ? proxyRelation[0] : proxyRelation;
      const block = getXApprovalBlockReason({ jobStatus: job.status, preparationStatus: job.preparation_status,
        account: { active: account.active, accountKey: account.account_key, executorId: account.executor_id,
          networkMode: account.network_mode, expectedEgressIp: account.expected_egress_ip,
          verificationStatus: account.verification_status, proxyStatus: proxy?.status ?? null },
        worker: worker ? { lastSeenAt: worker.last_seen_at, xuseAvailable: worker.xuse_available,
          configuredAccounts: Array.isArray(worker.configured_accounts) ? worker.configured_accounts : [],
          currentEgressIp: worker.current_egress_ip, networkProbeStatus: worker.network_probe_status } : null,
        nowMillis: now.getTime() });
      if (block) throw new Error(block);
      if (!worker || worker.execution_mode !== "send" || !supportsXReplyV2Worker(worker.worker_version)
        || job.content_mode === "account_product_preview" && !supportsXReplyV2PreviewWorker(worker.worker_version))
        throw new Error(job.content_mode === "account_product_preview"
          ? "附图回复需要 4.12.0 及以上的 Mac 发送执行器，并启用发送模式。"
          : "文字回复需要 4.11.0 及以上的 Mac 发送执行器，并启用发送模式。");
      const snapshotError = await validateV2Snapshot(supabase, job);
      if (snapshotError) throw new Error(snapshotError);
      if (await hasPriorXContact(supabase, job.target_author_id!, job.target_post_url!.split("/")[3], job.source_post_id!, job.id))
        throw new Error("历史已联系或已屏蔽。" );
      const { data: updated, error } = await supabase.rpc("approve_x_reply_job", {
        p_job_id: job.id, p_admin_id: admin.id, p_queue_version: 2,
      });
      if (error || updated !== true) throw new Error(error?.message ?? "任务已变化或今日额度已满，请刷新。" );
      result.ok++;
    } catch (error) { result.failed.push({ id: jobId, reason: error instanceof Error ? error.message : "批准失败" }); }
  }
  return finish(result);
}

export async function withdrawV2Draft(formData: FormData) {
  await requireAdmin(PATH);
  const jobId = String(formData.get("jobId") ?? "");
  if (!id.test(jobId)) throw new Error("任务 ID 无效");
  const { data, error } = await db().from("x_reply_jobs")
    .update({ status: "rejected", completed_at: new Date().toISOString() })
    .eq("id", jobId).eq("queue_version", 2).in("status", ["draft", "queued"])
    .eq("attempt_count", 0).select("id").maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "任务已领取或处理，无法撤回。");
  revalidatePath(PATH); revalidatePath("/admin/x-leads");
}
