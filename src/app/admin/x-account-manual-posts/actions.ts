"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { ACCOUNT_MANUAL_PATH, canonicalManualResultUrl, canonicalManualTargetUrl, MANUAL_HELPER_ID, MANUAL_SENDER_ID, manualReportError, manualWindowBlockReason, type ManualSnapshot } from "@/lib/x-account-manual";
import { loadManualRoute, manualDb } from "@/lib/x-account-manual-server";
import { hasPriorXContact, validateV2Snapshot } from "@/lib/x-reply-v2";

export type ManualActionState = { ok: number; failed: Array<{ id: string; reason: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const initial: ManualActionState = { ok: 0, failed: [] };
function finish(state: ManualActionState) {
  revalidatePath(ACCOUNT_MANUAL_PATH); revalidatePath("/admin/x-accounts"); revalidatePath("/admin/x-account-candidates"); return state;
}

/** Copies reviewed content only. It never generates, approves, opens X or sends. */
export async function addAccountManualDrafts(_previous: ManualActionState = initial, form: FormData): Promise<ManualActionState> {
  void _previous;
  const admin = await requireAdmin(ACCOUNT_MANUAL_PATH);
  const result: ManualActionState = { ok: 0, failed: [] };
  try {
    if (form.get("accountId") && form.get("accountId") !== MANUAL_SENDER_ID) throw new Error("本队列固定使用 theBestDiy / @Le6wCummeratawi。");
    await loadManualRoute();
  } catch (e) { return { ok: 0, failed: [{ id: "account", reason: String(e instanceof Error ? e.message : e) }] }; }
  const db = manualDb();
  const authors = [...new Set(form.getAll("authorId").map(String))].filter((v) => /^\d{5,30}$/.test(v)).slice(0, 100);
  if (!authors.length) return { ok: 0, failed: [{ id: "selection", reason: "请选择已有有效草稿。" }] };
  for (const author of authors) {
    try {
      const { data: d, error } = await db.from("x_lead_account_drafts").select("*").eq("author_id", author).maybeSingle();
      const { data: review } = await db.from("x_lead_account_reviews").select("x_handle").eq("author_id", author).maybeSingle();
      if (error || !d || d.status !== "draft_ready" || d.review_status !== "unreviewed" || !review?.x_handle) throw new Error("有效且未忽略的已审草稿不存在。");
      const handle = String(review.x_handle).replace(/^@/, "");
      if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error("目标账号无效。");
      const withPreview = d.preview_status === "ready";
      if (!withPreview && form.get("confirmTextOnly") !== "on") throw new Error("纯文字草稿须明确确认后才能加入。");
      if (!withPreview && form.get("preparationMode") !== "text_only") throw new Error("当前草稿没有预览图；请先单独准备并审阅，或明确选择纯文字。不会自动降级或生成。");
      const snapshot: ManualSnapshot = { queue_version: 2, content_mode: withPreview ? "account_product_preview" : "account_product_link",
        target_author_id: author, account_draft_author_id: author, source_post_id: d.selected_post_id,
        target_post_url: `https://x.com/${handle}/status/${d.selected_post_id}`, reply_text: d.reply_text,
        marketing_link_id: d.marketing_link_id, draft_generated_at: d.generated_at,
        account_artwork_path: withPreview ? d.artwork_path : null, account_artwork_hash: withPreview ? d.artwork_hash : null,
        account_preview_path: withPreview ? d.preview_path : null, account_preview_hash: withPreview ? d.preview_hash : null,
        account_preview_template_id: withPreview ? d.preview_template_id : null,
        product_slug_snapshot: d.product_slug, product_match_reason_snapshot: d.product_match_reason };
      const reason = await validateV2Snapshot(db, snapshot);
      if (reason) throw new Error(reason);
      if (await hasPriorXContact(db, author, handle, d.selected_post_id)) throw new Error("已有联系、未决结果或并行队列，不能重复加入。");
      const { error: insertError } = await db.from("x_account_manual_posts").insert({ account_id: MANUAL_SENDER_ID,
        target_author_id: author, target_handle: handle, source_post_id: d.selected_post_id,
        target_post_url: snapshot.target_post_url, reply_text: d.reply_text, snapshot, created_by: admin.id });
      if (insertError) throw new Error(insertError.code === "23505" ? "该作者已在手动队列。" : insertError.message);
      result.ok++;
    } catch (e) { result.failed.push({ id: author, reason: e instanceof Error ? e.message : "加入失败" }); }
  }
  return finish(result);
}

export async function reportAccountManualSent(_previous: ManualActionState, form: FormData): Promise<ManualActionState> {
  const admin = await requireAdmin(ACCOUNT_MANUAL_PATH);
  const id = String(form.get("taskId") ?? "");
  const url = canonicalManualResultUrl(String(form.get("resultUrl") ?? ""));
  const reportError = manualReportError({ resultUrl: String(form.get("resultUrl") ?? "") });
  if (!uuid.test(id) || !url || reportError) return { ok: 0, failed: [{ id, reason: reportError ?? "任务标识无效。" }] };
  const db = manualDb();
  const { data: row, error } = await db.from("x_account_manual_posts").select("id,status,account_id").eq("id", id).maybeSingle();
  if (error || !row || row.account_id !== MANUAL_SENDER_ID || row.status !== "draft") return { ok: 0, failed: [{ id, reason: "任务不存在或已登记，禁止重复处理。" }] };
  const { data, error: writeError } = await db.from("x_account_manual_posts")
    .update({ status: "reported", result_url: url, reported_at: new Date().toISOString(), reported_by: admin.id })
    .eq("id", id).eq("account_id", MANUAL_SENDER_ID).eq("status", "draft").select("id").maybeSingle();
  return finish(writeError || !data ? { ok: 0, failed: [{ id, reason: writeError?.message ?? "任务已变化。" }] } : { ok: 1, failed: [] });
}

async function enqueueManualWindow(adminId: string, taskId: string | null): Promise<ManualActionState> {
  const id = taskId ?? MANUAL_SENDER_ID;
  const purpose = taskId ? "manual_task_x_post" : "account_x_home";
  try {
    const route = await loadManualRoute(), db = manualDb();
    const { data: helper, error: helperError } = await db.from("x_account_manual_helpers").select("*").eq("helper_id", MANUAL_HELPER_ID).maybeSingle();
    if (helperError) throw new Error("独立手动助手状态不可读，未创建请求。");
    const block = manualWindowBlockReason(helper, route.revision, route.expectedIp);
    if (block) throw new Error(block);
    if (taskId) {
      const { data: row } = await db.from("x_account_manual_posts").select("id,status,account_id,snapshot,target_post_url").eq("id", taskId).maybeSingle();
      if (!row || row.status !== "draft" || row.account_id !== MANUAL_SENDER_ID) throw new Error("仅手动待发送任务可以请求打开目标帖子。");
      if (helper?.session_state !== "open" || !helper.session_id) throw new Error("请先在账号页建立原 x-use 绑定会话；帖子按钮不会新建 Cookie 会话。");
      if (!canonicalManualTargetUrl(row.target_post_url)) throw new Error("目标帖子链接无效。");
      const reason = await validateV2Snapshot(db, row.snapshot as ManualSnapshot);
      if (reason) throw new Error(reason);
    }
    let expiryQuery = db.from("x_account_manual_open_requests").update({ status: "failed", message: "请求已过期，未自动打开窗口。" })
      .eq("account_id", MANUAL_SENDER_ID).eq("purpose", purpose).eq("boot_id", helper!.boot_id).eq("status", "pending").lte("expires_at", new Date().toISOString());
    expiryQuery = taskId ? expiryQuery.eq("task_id", taskId) : expiryQuery.is("task_id", null);
    const { error: expiryError } = await expiryQuery;
    if (expiryError) throw new Error("无法确认旧请求状态，未创建新请求。");
    let priorQuery = db.from("x_account_manual_open_requests").select("id,status")
      .eq("account_id", MANUAL_SENDER_ID).eq("purpose", purpose).eq("boot_id", helper!.boot_id).in("status", ["pending", "opening", "blocked"]);
    priorQuery = taskId ? priorQuery.eq("task_id", taskId) : priorQuery.is("task_id", null);
    const { data: prior, error: priorError } = await priorQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (priorError) throw new Error("无法确认当前请求状态，未创建新请求。");
    if (prior) throw new Error(prior.status === "blocked" ? "该会话已阻断，须人工核对；不会自动重开。" : "当前开窗请求仍在处理中，结果未确认。请勿重复点击。");
    const { error } = await db.from("x_account_manual_open_requests").insert({ task_id: taskId, purpose, account_id: MANUAL_SENDER_ID,
      helper_id: MANUAL_HELPER_ID, boot_id: helper!.boot_id, route_revision: route.revision,
      expected_ip: route.expectedIp, created_by: adminId });
    if (error) throw new Error(error.message);
    return finish({ ok: 1, failed: [] });
  } catch (e) { return { ok: 0, failed: [{ id, reason: e instanceof Error ? e.message : "开窗请求失败" }] }; }
}

export async function requestAccountManualWindow(_previous: ManualActionState, form: FormData): Promise<ManualActionState> {
  const admin = await requireAdmin(ACCOUNT_MANUAL_PATH), id = String(form.get("taskId") ?? "");
  if (!uuid.test(id)) return { ok: 0, failed: [{ id, reason: "任务标识无效。" }] };
  return enqueueManualWindow(admin.id, id);
}

export async function requestAccountIpWindow(_previous: ManualActionState, form: FormData): Promise<ManualActionState> {
  const admin = await requireAdmin("/admin/x-accounts"), id = String(form.get("accountId") ?? "");
  if (id !== MANUAL_SENDER_ID) return { ok: 0, failed: [{ id, reason: "只为已启用的固定手动账号开放 x-use 首页窗口。" }] };
  return enqueueManualWindow(admin.id, null);
}

/** Legacy IP-only confirmations cannot authorize the new X-home protocol. */
export async function confirmAccountManualIp(_previous: ManualActionState, _form: FormData): Promise<ManualActionState> {
  void _previous; void _form;
  await requireAdmin(ACCOUNT_MANUAL_PATH);
  return { ok: 0, failed: [{ id: "legacy", reason: "旧 IP-only 确认入口已停用；请使用新的 x-use 手动主页入口。" }] };
}
