"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getAppUrl, getXLeadWorkerSecret } from "@/lib/env";
import { getActiveFirstOrderPromotion } from "@/lib/first-order-promotion";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { canAdvertiseFirstOrder25 } from "@/lib/x-lead-copy";
import { ACCOUNT_DRAFT_VERSION, createAccountReply, selectAccountDraft,
  type AccountDraftInput, type DraftSelection } from "@/lib/x-lead-account-draft";
import { ensureAccountProductLink } from "@/lib/x-lead-account-marketing";
import { getActiveAccountProducts } from "@/lib/x-lead-account-products";

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
};

function writeFromSelection(selection: DraftSelection): DraftWrite {
  return { status: selection.status, reason: selection.reason,
    evidence_coverage: selection.evidenceCoverage,
    selected_post_id: selection.selectedPost?.post_id ?? null,
    selected_post_created_at: selection.selectedPost?.created_at ?? null,
    selected_post_excerpt: selection.selectedPost?.text.slice(0, 500) ?? null,
    product_slug: selection.productSlug, product_match_reason: selection.productMatchReason,
    reply_text: null, marketing_link_id: null, marketing_url: null, marketing_expires_at: null,
    generation_version: ACCOUNT_DRAFT_VERSION, generated_at: new Date().toISOString() };
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

async function contactedSnapshot() {
  const secret = getXLeadWorkerSecret();
  if (!secret) throw new Error("Contacted snapshot is not configured");
  const response = await fetch(`${getAppUrl()}/api/x-leads/worker/contacted-snapshot`, {
    headers: { authorization: `Bearer ${secret}` }, cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Contacted snapshot is unavailable");
  const value = await response.json() as { author_ids?: unknown; handles?: unknown; post_ids?: unknown };
  if (!Array.isArray(value.author_ids) || !Array.isArray(value.handles) || !Array.isArray(value.post_ids))
    throw new Error("Contacted snapshot is incomplete");
  return { authors: new Set(value.author_ids.map(String)), handles: new Set(value.handles.map(String)),
    posts: new Set(value.post_ids.map(String)) };
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
