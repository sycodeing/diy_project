"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { ACCOUNT_MANUAL_PATH, canonicalManualResultUrl, freshManualHelper, MANUAL_HELPER_ID, MANUAL_SENDER_ID, manualReportError, type ManualSnapshot } from "@/lib/x-account-manual";
import { loadManualRoute, manualDb } from "@/lib/x-account-manual-server";
import { hasPriorXContact, validateV2Snapshot } from "@/lib/x-reply-v2";

export type ManualActionState = { ok: number; failed: Array<{ id: string; reason: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const initial: ManualActionState = { ok: 0, failed: [] };
function finish(state: ManualActionState) {
  revalidatePath(ACCOUNT_MANUAL_PATH); revalidatePath("/admin/x-account-candidates"); return state;
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
  if (!uuid.test(id) || !url || form.get("personallySent") !== "yes") return { ok: 0, failed: [{ id, reason: "请确认已由本人使用指定账号发送，并填写该账号的真实结果链接。" }] };
  const db = manualDb();
  const { data: row, error } = await db.from("x_account_manual_posts").select("id,status,account_id,snapshot").eq("id", id).maybeSingle();
  if (error || !row || row.account_id !== MANUAL_SENDER_ID || row.status !== "draft") return { ok: 0, failed: [{ id, reason: "任务不存在或已登记，禁止重复处理。" }] };
  const reportError = manualReportError({ contentMode: (row.snapshot as ManualSnapshot).content_mode,
    resultUrl: url, personallySent: form.get("personallySent") === "yes", previewUploaded: form.get("previewUploaded") === "yes" });
  if (reportError) return { ok: 0, failed: [{ id, reason: reportError }] };
  const { data, error: writeError } = await db.from("x_account_manual_posts")
    .update({ status: "reported", result_url: url, reported_at: new Date().toISOString(), reported_by: admin.id,
      preview_uploaded_by_user: form.get("previewUploaded") === "yes" })
    .eq("id", id).eq("account_id", MANUAL_SENDER_ID).eq("status", "draft").select("id").maybeSingle();
  return finish(writeError || !data ? { ok: 0, failed: [{ id, reason: writeError?.message ?? "任务已变化。" }] } : { ok: 1, failed: [] });
}

export async function requestAccountManualWindow(_previous: ManualActionState, form: FormData): Promise<ManualActionState> {
  const admin = await requireAdmin(ACCOUNT_MANUAL_PATH);
  const id = String(form.get("taskId") ?? "");
  if (!uuid.test(id) || form.get("understandProfile") !== "yes") return { ok: 0, failed: [{ id, reason: "请确认独立持久窗口、首次本人登录和只打开IP检查页的边界。" }] };
  try {
    const route = await loadManualRoute();
    const db = manualDb();
    const { data: helper } = await db.from("x_account_manual_helpers").select("*").eq("helper_id", MANUAL_HELPER_ID).maybeSingle();
    if (!freshManualHelper(helper)) throw new Error("独立手动助手未在线，请先手动启动。当前不会积压开窗请求。");
    if (["blocked", "closed"].includes(helper!.session_state)) throw new Error("原绑定会话已关闭或阻断；请本人核对窗口并显式重新启动独立助手，不会自动重开。");
    const { data: row } = await db.from("x_account_manual_posts").select("id,status,account_id,snapshot").eq("id", id).maybeSingle();
    if (!row || row.status !== "draft" || row.account_id !== MANUAL_SENDER_ID) throw new Error("仅手动待发送任务可以请求IP核对窗口。");
    const reason = await validateV2Snapshot(db, row.snapshot as ManualSnapshot);
    if (reason) throw new Error(reason);
    await db.from("x_account_manual_open_requests").update({ status: "failed", message: "请求已过期，未自动打开窗口。" })
      .eq("task_id", id).eq("boot_id", helper!.boot_id).eq("status", "pending").lte("expires_at", new Date().toISOString());
    const { data: prior } = await db.from("x_account_manual_open_requests").select("id,status")
      .eq("task_id", id).eq("boot_id", helper!.boot_id).in("status", ["pending", "opening", "blocked"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (prior) throw new Error(prior.status === "blocked" ? "该会话已阻断，须人工核对；不会自动重开。" : "当前开窗请求仍在处理中。请勿重复点击。");
    const { error } = await db.from("x_account_manual_open_requests").insert({ task_id: id, account_id: MANUAL_SENDER_ID,
      helper_id: MANUAL_HELPER_ID, boot_id: helper!.boot_id, route_revision: route.revision,
      expected_ip: route.expectedIp, created_by: admin.id });
    if (error) throw new Error(error.message);
    return finish({ ok: 1, failed: [] });
  } catch (e) { return { ok: 0, failed: [{ id, reason: e instanceof Error ? e.message : "开窗请求失败" }] }; }
}

export async function confirmAccountManualIp(_previous: ManualActionState, form: FormData): Promise<ManualActionState> {
  const admin = await requireAdmin(ACCOUNT_MANUAL_PATH);
  const id = String(form.get("requestId") ?? "");
  if (!uuid.test(id) || form.get("checkedIp") !== "yes") return { ok: 0, failed: [{ id, reason: "请本人核对窗口IP后再确认。" }] };
  try {
    const db = manualDb(), route = await loadManualRoute();
    const { data: helper } = await db.from("x_account_manual_helpers").select("*").eq("helper_id", MANUAL_HELPER_ID).maybeSingle();
    if (!freshManualHelper(helper)) throw new Error("助手会话已失效，请勿沿用旧IP确认。");
    if (helper!.session_state !== "open" || !helper!.session_id || helper!.route_revision !== route.revision || helper!.expected_ip !== route.expectedIp)
      throw new Error("当前本机窗口已关闭、阻断或绑定变化，不能使用历史确认。");
    const { data, error } = await db.from("x_account_manual_open_requests")
      .update({ status: "ip_confirmed", user_confirmed_at: new Date().toISOString(), user_confirmed_by: admin.id })
      .eq("id", id).eq("boot_id", helper!.boot_id).eq("account_id", MANUAL_SENDER_ID)
      .eq("route_revision", route.revision).eq("expected_ip", route.expectedIp)
      .eq("status", "opened_manual_check").eq("session_id", helper!.session_id).select("id").maybeSingle();
    if (error || !data) throw new Error(error?.message ?? "会话、账号或绑定已变化，不能沿用此次确认。");
    return finish({ ok: 1, failed: [] });
  } catch (e) { return { ok: 0, failed: [{ id, reason: e instanceof Error ? e.message : "确认失败" }] }; }
}
