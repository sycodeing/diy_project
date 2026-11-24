"use server";

import { createHash } from "node:crypto";
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
import { createAccountDesignAssetFromBytes, accountRenderRevision, pickAccountTemplate } from "@/lib/x-account-design-assets";
import { accountDesignBrief, selectAccountDesign } from "@/lib/x-account-design-selector";
import { reuseManualAccountPreview } from "@/lib/x-account-manual-preview";
import { loadAccountArtwork } from "@/lib/x-account-design-recipes";
import { contactedSnapshot } from "@/lib/x-account-contacted-snapshot";
import { validateV2Snapshot, type V2Snapshot } from "@/lib/x-reply-v2";

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

async function saveDraft(authorId: string, row: DraftWrite, expectedGeneratedAt: string | null) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase is not configured");
  if (expectedGeneratedAt === null) {
    const { error } = await supabase.from("x_lead_account_drafts").insert({ author_id: authorId, ...row });
    if (error) throw new Error(error.code === "23505" ? "草稿在准备期间已由其他操作生成，请刷新。" : error.message);
    return;
  }
  const { data, error } = await supabase.from("x_lead_account_drafts")
    .update(row).eq("author_id", authorId).eq("generated_at", expectedGeneratedAt)
    .eq("review_status", "unreviewed").select("author_id").maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "草稿在准备期间已变化，请刷新。");
}

export async function ensurePreparedAccountDraft(authorId: string, mode: "auto_preview" | "text_only" = "auto_preview", force = false): Promise<{ status: "ready" | "text_only" | "no_design_match" | "blocked"; reason: string }> {
  await requireAdmin("/admin/x-account-candidates");
  if (!/^\d{5,30}$/.test(authorId)) throw new Error("Invalid account ID");
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase is not configured");
    const [{ data: account, error }, { data: previous, error: previousError }, { data: jobs, error: jobsError }, products, snapshot, { data: manualJobs, error: manualError }] = await Promise.all([
      supabase.from("x_lead_account_reviews")
        .select("author_id,x_handle,account_status,entry_status,review_status,account_evidence,entry_evidence")
        .eq("author_id", authorId).maybeSingle(),
      supabase.from("x_lead_account_drafts")
        .select("author_id,status,review_status,selected_post_id,product_slug,reply_text,marketing_link_id,marketing_url,marketing_expires_at,generated_at,generation_version,preview_status,design_source,design_brief,artwork_path,artwork_hash,preview_path,preview_hash,preview_template_id")
        .eq("author_id", authorId).maybeSingle(),
      supabase.from("x_reply_jobs").select("id").eq("target_author_id", authorId)
        .in("status", ["draft", "queued", "claimed", "sent", "uncertain"]).limit(1),
      getActiveAccountProducts(), contactedSnapshot(),
      supabase.from("x_account_manual_posts").select("id").eq("target_author_id", authorId).in("status", ["draft", "reported"]).limit(1),
    ]);
    if (error || previousError || jobsError || !account) throw new Error(error?.message ?? previousError?.message ?? jobsError?.message ?? "Account review is missing");
    if (manualError) throw new Error("手动队列状态不可读，停止改写草稿。");
    if (jobs?.length || manualJobs?.length) throw new Error("该账号已有待审、人工或执行任务，不能改写其草稿快照。");
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
        selectedPost: null, productSlug: null, productMatchReason: null, conversationAngle: null, matchStrength: 0 }), previous?.generated_at ?? null);
      revalidatePath("/admin/x-account-candidates");
      return { status: "blocked", reason: "账号或所选帖子已有联系记录" };
    }
    const row = writeFromSelection(selection);
    if (selection.status === "draft_ready" && selection.productSlug && selection.selectedPost) {
      const product = products.find((item) => item.slug === selection.productSlug)!;
      const promotion = await getActiveFirstOrderPromotion();
      const offer = canAdvertiseFirstOrder25(promotion, product.variants);
      let asset;
      let design;
      if (mode === "auto_preview") {
        let priorBrief: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(String(previous?.design_brief ?? ""));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) priorBrief = parsed as Record<string, unknown>;
        } catch { /* stale brief */ }
        const templateId = pickAccountTemplate(product);
        const reusablePreview = async () => {
          if (!previous || previous.preview_status !== "ready" || previous.selected_post_id !== selection.selectedPost?.post_id
            || previous.product_slug !== product.slug || previous.preview_template_id !== templateId
            || !Number.isFinite(Date.parse(String(previous.marketing_expires_at ?? "")))
            || Date.parse(String(previous.marketing_expires_at ?? "")) <= Date.now() + 24 * 60 * 60_000) return false;
          const handleForJob = String(account.x_handle ?? "").replace(/^@/, "");
          const check: V2Snapshot = { queue_version: 2, content_mode: "account_product_preview",
            target_author_id: authorId, account_draft_author_id: authorId, marketing_link_id: previous.marketing_link_id,
            source_post_id: previous.selected_post_id, draft_generated_at: previous.generated_at,
            target_post_url: `https://x.com/${handleForJob}/status/${previous.selected_post_id}`,
            reply_text: previous.reply_text, account_artwork_path: previous.artwork_path,
            account_artwork_hash: previous.artwork_hash, account_preview_path: previous.preview_path,
            account_preview_hash: previous.preview_hash, account_preview_template_id: previous.preview_template_id };
          return !await validateV2Snapshot(supabase, check);
        };
        // A reviewed brand-owned manual upload stays attached during ordinary queue preparation.
        // The explicit regenerate action passes force=true and replaces it with an automatic design.
        if (await reuseManualAccountPreview(previous?.design_source, priorBrief, force, reusablePreview))
          return { status: "ready", reason: "已复用当前有效人工设计图文草稿" };
        design = selectAccountDesign(selection);
        if (design.kind !== "no_design_match") {
          const brief = accountDesignBrief(design, templateId ? accountRenderRevision(templateId) : "");
          const bytes = await loadAccountArtwork(design, product.slug);
          const artworkHash = createHash("sha256").update(bytes).digest("hex");
          if (!force && previous?.preview_status === "ready" && previous.selected_post_id === selection.selectedPost.post_id
            && previous.product_slug === product.slug && previous.generation_version === ACCOUNT_DRAFT_VERSION
            && previous.artwork_hash === artworkHash && previous.preview_template_id === templateId
            && priorBrief.designId === design.designId
            && priorBrief.matchType === brief.matchType
            && priorBrief.fallbackReason === brief.fallbackReason
            && priorBrief.paletteSource === brief.paletteSource
            && priorBrief.renderRevision === (templateId ? accountRenderRevision(templateId) : null)
            && await reusablePreview()) return { status: "ready", reason: "已复用当前有效图文草稿" };
          asset = await createAccountDesignAssetFromBytes(bytes, product);
        }
      }
      const link = await ensureAccountProductLink(authorId, selection.selectedPost.post_id, product.slug, asset);
      row.reply_text = createAccountReply(selection, link.url, offer,
        design?.kind !== "no_design_match" && design ? { preview: {
          visibleMotifs: design.visibleMotifs, designReason: design.designReason,
          matchType: design.kind === "procedural" ? design.matchType : "stated_style" } } : {});
      row.marketing_link_id = link.id;
      row.marketing_url = link.url;
      row.marketing_expires_at = link.expiresAt;
      if (asset && design && design.kind !== "no_design_match") Object.assign(row, {
        design_source: "brand_created", design_brief: JSON.stringify(accountDesignBrief(design, accountRenderRevision(asset.templateId))),
        artwork_path: asset.artworkPath, artwork_hash: asset.artworkHash,
        preview_path: asset.previewPath, preview_hash: asset.previewHash,
        preview_template_id: asset.templateId, preview_status: "ready",
      });
      if (mode === "auto_preview" && design?.kind === "no_design_match") {
        row.reason = `${selection.reason}；${design.reason}`;
      }
    }
    // Rendering can take time. Do not replace a draft that changed or entered the queue meanwhile.
    const [{ data: fresh, error: freshError }, { data: active, error: activeError }] = await Promise.all([
      supabase.from("x_lead_account_drafts").select("generated_at,review_status").eq("author_id", authorId).maybeSingle(),
      supabase.from("x_reply_jobs").select("id").eq("target_author_id", authorId)
        .in("status", ["draft", "queued", "claimed", "sent", "uncertain"]).limit(1),
    ]);
    if (freshError || activeError) throw new Error("重核草稿或队列失败，请稍后重试。");
    if (active?.length || fresh?.review_status === "dismissed" || fresh?.generated_at !== (previous?.generated_at ?? undefined))
      throw new Error("草稿或队列在准备期间已变化，请刷新后重试。");
    await saveDraft(authorId, row, previous?.generated_at ?? null);
    revalidatePath("/admin/x-account-candidates");
    if (selection.status !== "draft_ready") return { status: "blocked", reason: selection.reason };
    if (mode === "auto_preview" && row.preview_status !== "ready") return { status: "no_design_match", reason: row.reason };
    return { status: mode === "auto_preview" ? "ready" : "text_only", reason: "待审草稿已保存" };
}

export async function generateAccountReplyDraft(formData: FormData) {
  const authorId = String(formData.get("authorId") ?? "");
  const mode = formData.get("mode") === "text_only" ? "text_only" : "auto_preview";
  await ensurePreparedAccountDraft(authorId, mode, true);
}

export async function setAccountDraftReviewStatus(formData: FormData) {
  const user = await requireAdmin("/admin/x-account-candidates");
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
  revalidatePath("/admin/x-account-candidates");
}

type PreviewActionState = { ok: boolean; message: string };

/** Explicit admin action: store original brand artwork, render its product mockup, and replace only this unqueued draft. */
export async function attachAccountPreview(_previous: PreviewActionState | undefined, formData: FormData): Promise<PreviewActionState> {
  void _previous;
  await requireAdmin("/admin/x-account-candidates");
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
    revalidatePath("/admin/x-account-candidates");
    return { ok: true, message: "原创设计及商品模板预览已保存为新的待审图文草稿。" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "预览生成失败。" };
  }
}
