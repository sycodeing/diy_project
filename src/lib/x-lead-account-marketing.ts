import { createHash, createHmac } from "node:crypto";
import { getAppUrl, getMarketingIngestSecret } from "@/lib/env";
import { hashMarketingToken } from "@/lib/marketing";
import { createMarketingLinkTokens } from "@/lib/marketing-token";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { ActiveDraftProduct } from "@/lib/x-lead-account-draft";
import { getActiveAccountProducts } from "@/lib/x-lead-account-products";
import { validAccountDesignAsset, type AccountDesignAsset } from "@/lib/x-account-design-assets";

/** A product destination; optional brand-owned artwork creates a distinct immutable link identity. */
export async function ensureAccountProductLink(authorId: string, postId: string, productSlug: ActiveDraftProduct["slug"],
  asset?: AccountDesignAsset) {
  const supabase = getSupabaseServiceClient();
  const secret = getMarketingIngestSecret();
  if (!supabase || !secret) throw new Error("Marketing links are unavailable");
  if (!(await getActiveAccountProducts()).some((product) => product.slug === productSlug))
    throw new Error("Selected product is no longer available");
  if (asset && !validAccountDesignAsset(asset, productSlug)) throw new Error("Account artwork identity is invalid");
  const day = new Date().toISOString().slice(0, 10);
  const identity = `${authorId}:${postId}:${productSlug}:${day}${asset ? `:${asset.artworkHash}:${asset.previewHash}` : ""}`;
  const idempotencyKey = `x-account-draft:${createHash("sha256").update(identity).digest("hex")}`;
  const sourceHash = createHmac("sha256", secret).update(`account-draft:${authorId}:${postId}`).digest("hex");
  const authorHash = createHmac("sha256", secret).update(`x-author:${authorId}`).digest("hex");
  const token = createMarketingLinkTokens(secret, idempotencyKey).preferred;
  const tokenHash = hashMarketingToken(token);
  const expiry = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
  const { data: inserted, error: insertError } = await supabase.from("marketing_links").insert({
    token_hash: tokenHash, short_token_hash: tokenHash, idempotency_key: idempotencyKey,
    campaign: "account_review_draft", channel: "public_reply", variant: asset ? "account_preview_v1" : "account_context_v1",
    source_hash: sourceHash, source_image_url: null, product_slug: productSlug,
    x_post_id: postId, x_post_url: `https://x.com/i/status/${postId}`, x_author_hash: authorHash,
    account_artwork_path: asset?.artworkPath ?? null, account_artwork_hash: asset?.artworkHash ?? null,
    account_preview_path: asset?.previewPath ?? null, account_preview_hash: asset?.previewHash ?? null,
    account_preview_template_id: asset?.templateId ?? null,
    expires_at: expiry,
  }).select("id,expires_at,product_slug,source_image_url,token_hash,x_post_id,x_author_hash,account_artwork_path,account_artwork_hash,account_preview_path,account_preview_hash,account_preview_template_id").single();
  let link = inserted;
  if (insertError || !link) {
    const { data: existing, error } = await supabase.from("marketing_links")
      .select("id,expires_at,product_slug,source_image_url,token_hash,x_post_id,x_author_hash,account_artwork_path,account_artwork_hash,account_preview_path,account_preview_hash,account_preview_template_id")
      .eq("idempotency_key", idempotencyKey).maybeSingle();
    if (error || !existing) throw new Error(insertError?.message ?? "Marketing link could not be created");
    link = existing;
  }
  if (link.token_hash !== tokenHash || link.product_slug !== productSlug || link.source_image_url
    || link.x_post_id !== postId || link.x_author_hash !== authorHash
    || link.account_artwork_path !== (asset?.artworkPath ?? null)
    || link.account_artwork_hash !== (asset?.artworkHash ?? null)
    || link.account_preview_path !== (asset?.previewPath ?? null)
    || link.account_preview_hash !== (asset?.previewHash ?? null)
    || link.account_preview_template_id !== (asset?.templateId ?? null)
    || Date.parse(link.expires_at) <= Date.now()) throw new Error("Marketing link identity or destination mismatch");
  return { id: link.id, url: `${getAppUrl()}/g/${token}`, expiresAt: link.expires_at };
}
