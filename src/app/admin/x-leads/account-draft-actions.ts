"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getActiveFirstOrderPromotion } from "@/lib/first-order-promotion";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { canAdvertiseFirstOrder25 } from "@/lib/x-lead-copy";
import { ACCOUNT_DRAFT_VERSION, createAccountReply, selectAccountDraft, validAccountPreviewBrief,
  type AccountDraftInput, type DraftSelection } from "@/lib/x-lead-account-draft";
import { ensureAccountProductLink } from "@/lib/x-lead-account-marketing";
import { getActiveAccountProducts } from "@/lib/x-lead-account-products";
import { createAccountDesignAsset } from "@/lib/x-account-design-assets";
import { contactedSnapshot } from "@/lib/x-account-contacted-snapshot";

type DraftWrite = {
  status: DraftSelection["status"];
  reason: string;
  evidence_coverage: "full" | "partial";
  selected_post_id: string | null;
  selected_post_created_at: string | null;
  selected_post_excerpt: string | null;
  product_slug: string | null;
  product_match_reason: string | null;
  reply_text: string | null;
  marketing_link_id: string | null;
  marketing_url: string | null;
  marketing_expires_at: string | null;
  generation_version: string;
  generated_at: string;
  design_source: "brand_created" | null;
  design_brief: string | null;
  artwork_path: string | null;
  artwork_hash: string | null;
  preview_path: string | null;
  preview_hash: string | null;
  preview_template_id: string | null;
  preview_status: "text_only" | "ready" | "failed";
};

function writeFromSelection(selection: DraftSelection): DraftWrite {
  return { status: selection.status, reason: selection.reason,
    evidence_coverage: selection.evidenceCoverage,
    selected_post_id: selection.selectedPost?.post_id ?? null,
    selected_post_created_at: selection.selectedPost?.created_at ?? null,
    selected_post_excerpt: selection.selectedPost?.text.slice(0, 500) ?? null,
    product_slug: selection.productSlug, product_match_reason: selection.productMatchReason,
    reply_text: null, marketing_link_id: null, marketing_url: null, marketing_expires_at: null,
    generation_version: ACCOUNT_DRAFT_VERSION, generated_at: new Date().toISOString(),
    design_source: null, design_brief: null, artwork_path: null, artwork_hash: null,
    preview_path: null, preview_hash: null, preview_template_id: null, preview_status: "text_only" };
}

async function saveDraft(authorId: string, row: DraftWrite) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: existing, error: lookupError } = await supabase.from("x_lead_account_drafts")
    .select("author_id").eq("author_id", authorId).maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  const result = existing
    ? await supabase.from("x_lead_account_drafts").update(row).eq("author_id", authorId)
    : await supabase.from("x_lead_account_drafts").insert({ author_id: authorId, ...row });
  if (result.error) {
    // A concurrent first generation may have inserted the row. The retry still never touches review_*.
    if (!existing && result.error.code === "23505") {
      const retry = await supabase.from("x_lead_account_drafts").update(row).eq("author_id", authorId);
      if (!retry.error) return;
    }
    throw new Error(result.error.message);
  }
}

export async function generateAccountReplyDraft(formData: FormData) {
  await requireAdmin("/admin/x-leads?mode=account_review");
  const authorId = String(formData.get("authorId") ?? "");
  if (!/^\d{5,30}$/.test(authorId)) throw new Error("Invalid account ID");
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase is not configured");
  try {
    const [{ data: account, error }, products, snapshot] = await Promise.all([
      supabase.from("x_lead_account_reviews")
        .select("author_id,x_handle,account_status,entry_status,review_status,account_evidence,entry_evidence")
        .eq("author_id", authorId).maybeSingle(),
      getActiveAccountProducts(), contactedSnapshot(),
    ]);
    if (error || !account) throw new Error(error?.message ?? "Account review is missing");
    const evidence = account.account_evidence && typeof account.account_evidence === "object" && !Array.isArray(account.account_evidence)
      ? account.account_evidence as Record<string, unknown> : {};
    const entry = account.entry_evidence && typeof account.entry_evidence === "object" && !Array.isArray(account.entry_evidence)
      ? account.entry_evidence as Record<string, unknown> : {};
    const selection = selectAccountDraft({ ...account, account_evidence: evidence, entry_evidence: entry } as AccountDraftInput, products);
    const handle = String(account.x_handle ?? "").toLowerCase();
    const selectedPostId = selection.selectedPost?.post_id;
    const anyOwnContacted = Array.isArray(evidence.own_post_ids)
      && evidence.own_post_ids.some((id) => snapshot.posts.has(String(id)));
    if (snapshot.authors.has(authorId) || (handle && snapshot.handles.has(handle))
      || (selectedPostId && snapshot.posts.has(selectedPostId)) || anyOwnContacted) {
      await saveDraft(authorId, writeFromSelection({ ...selection, status: "blocked", reason: "账号或所选帖子已有联系记录",
        selectedPost: null, productSlug: null, productMatchReason: null, conversationAngle: null, matchStrength: 0 }));
      return revalidatePath("/admin/x-leads");
    }
    const row = writeFromSelection(selection);
    if (selection.status === "draft_ready" && selection.productSlug && selection.selectedPost) {
      const product = products.find((item) => item.slug === selection.productSlug)!;
      const promotion = await getActiveFirstOrderPromotion();
      const offer = canAdvertiseFirstOrder25(promotion, product.variants);
      const link = await ensureAccountProductLink(authorId, selection.selectedPost.post_id, product.slug);
      row.reply_text = createAccountReply(selection, link.url, offer);
      row.marketing_link_id = link.id;
      row.marketing_url = link.url;
      row.marketing_expires_at = link.expiresAt;
    }
    await saveDraft(authorId, row);
  } catch {
    // Regeneration never leaves a stale ready draft visible after verification fails.
    await saveDraft(authorId, writeFromSelection({ status: "blocked", reason: "本次重生成未能核实联系人、商品或链接，请稍后重试",
      evidenceCoverage: "partial", selectedPost: null, productSlug: null, productMatchReason: null,
      conversationAngle: null, matchStrength: 0 }));
  }
  revalidatePath("/admin/x-leads");
}

export async function setAccountDraftReviewStatus(formData: FormData) {
  const user = await requireAdmin("/admin/x-leads?mode=account_review");
  const authorId = String(formData.get("authorId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!/^\d{5,30}$/.test(authorId) || !["unreviewed", "dismissed"].includes(status))
    throw new Error("Invalid draft review status");
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("x_lead_account_drafts")
    .update({ review_status: status, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("author_id", authorId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/x-leads");
}

type PreviewActionState = { ok: boolean; message: string };

/** Explicit admin action: store original brand artwork, render its product mockup, and replace only this unqueued draft. */
export async function attachAccountPreview(_previous: PreviewActionState | undefined, formData: FormData): Promise<PreviewActionState> {
  void _previous;
  await requireAdmin("/admin/x-leads?mode=account_review");
  const authorId = String(formData.get("authorId") ?? "");
  const motifs = String(formData.get("visibleMotifs") ?? "").trim();
  const reason = String(formData.get("designReason") ?? "").trim();
  const file = formData.get("artwork");
  if (!/^\d{5,30}$/.test(authorId) || formData.get("designSource") !== "brand_created"
    || formData.get("brandOwned") !== "on" || !(file instanceof File))
    return { ok: false, message: "请选择本店有权使用的原创平面设计，并确认素材来源。" };
  if (!validAccountPreviewBrief({ visibleMotifs: motifs, designReason: reason }))
    return { ok: false, message: "请用简短、具体且已审图的词语描述可见图案与设计理由。" };
  const supabase = getSupabaseServiceClient();
  if (!supabase) return { ok: false, message: "数据服务不可用。" };
  try {
    const [{ data: account, error: accountError }, { data: draft, error: draftError }, products, contacts,
      { data: priorJobs, error: jobError }] = await Promise.all([
      supabase.from("x_lead_account_reviews").select("author_id,x_handle,account_status,entry_status,review_status,account_evidence,entry_evidence")
        .eq("author_id", authorId).maybeSingle(),
      supabase.from("x_lead_account_drafts").select("author_id,status,review_status,selected_post_id,product_slug,generated_at")
        .eq("author_id", authorId).maybeSingle(),
      getActiveAccountProducts(), contactedSnapshot(),
      supabase.from("x_reply_jobs").select("id").eq("target_author_id", authorId)
        .in("status", ["draft", "queued", "claimed", "sent", "uncertain"]).limit(1),
    ]);
    if (accountError || draftError || jobError || !account || !draft) throw new Error("账号或草稿不可读。" );
    if (priorJobs?.length) throw new Error("已有待审或执行中的任务，请先处理该队列快照。" );
    const handle = String(account.x_handle ?? "").toLowerCase().replace(/^@/, "");
    const evidence = account.account_evidence && typeof account.account_evidence === "object" && !Array.isArray(account.account_evidence)
      ? account.account_evidence as Record<string, unknown> : {};
    const entry = account.entry_evidence && typeof account.entry_evidence === "object" && !Array.isArray(account.entry_evidence)
      ? account.entry_evidence as Record<string, unknown> : {};
    const selection = selectAccountDraft({ ...account, account_evidence: evidence, entry_evidence: entry } as AccountDraftInput, products);
    if (draft.status !== "draft_ready" || draft.review_status === "dismissed" || selection.status !== "draft_ready"
      || !selection.selectedPost || !selection.productSlug || selection.selectedPost.post_id !== draft.selected_post_id
      || selection.productSlug !== draft.product_slug) throw new Error("当前本人帖或商品匹配已变化，请先重生成文字草稿。" );
    if (contacts.authors.has(authorId) || handle && contacts.handles.has(handle)
      || contacts.posts.has(selection.selectedPost.post_id)
      || Array.isArray(evidence.own_post_ids) && evidence.own_post_ids.some((id) => contacts.posts.has(String(id))))
      throw new Error("账号或其本人帖子已有联系记录。" );
    const product = products.find((item) => item.slug === selection.productSlug)!;
    const asset = await createAccountDesignAsset(file, product);
    const link = await ensureAccountProductLink(authorId, selection.selectedPost.post_id, product.slug, asset);
    const promotion = await getActiveFirstOrderPromotion();
    const copy = createAccountReply(selection, link.url, canAdvertiseFirstOrder25(promotion, product.variants),
      { preview: { visibleMotifs: motifs, designReason: reason } });
    const next = writeFromSelection(selection);
    Object.assign(next, { reply_text: copy, marketing_link_id: link.id, marketing_url: link.url,
      marketing_expires_at: link.expiresAt, design_source: "brand_created", design_brief: JSON.stringify({
        visibleMotifs: motifs, designReason: reason, selectedPostId: selection.selectedPost.post_id,
      }), artwork_path: asset.artworkPath, artwork_hash: asset.artworkHash, preview_path: asset.previewPath,
      preview_hash: asset.previewHash, preview_template_id: asset.templateId, preview_status: "ready" });
    const { data: changed, error: updateError } = await supabase.from("x_lead_account_drafts")
      .update(next).eq("author_id", authorId).eq("generated_at", draft.generated_at)
      .eq("review_status", "unreviewed").select("author_id").maybeSingle();
    if (updateError || !changed) throw new Error("草稿在预览生成期间发生变化；本次结果未覆盖人工审阅。" );
    revalidatePath("/admin/x-leads");
    return { ok: true, message: "原创设计及商品模板预览已保存为新的待审图文草稿。" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "预览生成失败。" };
  }
}
