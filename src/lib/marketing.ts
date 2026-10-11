import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const MARKETING_COOKIE_NAME = "diy_marketing_touch";
export const MARKETING_ATTRIBUTION_SECONDS = 7 * 24 * 60 * 60;

export type MarketingEventType =
  | "link_generated"
  | "link_clicked"
  | "design_opened"
  | "preview_ready"
  | "account_linked"
  | "checkout_started"
  | "payment_completed";

export function hashMarketingToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function safeHexEqual(received: string, expected: string) {
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  const left = Buffer.from(received, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function getActiveMarketingLinkFromCookie() {
  const token = (await cookies()).get(MARKETING_COOKIE_NAME)?.value;
  if (!token) return null;

  const supabase = getSupabaseServiceClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("marketing_links")
    .select("id,expires_at,source_hash,source_image_url,created_at,account_user_id")
    .eq("token_hash", hashMarketingToken(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  return data ?? null;
}

export async function linkMarketingAccount(
  marketingLink: NonNullable<Awaited<ReturnType<typeof getActiveMarketingLinkFromCookie>>>,
  user: { id: string; created_at: string },
) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return { error: new Error("Marketing storage is not configured.") };

  if (marketingLink.account_user_id && marketingLink.account_user_id !== user.id) {
    return { error: new Error("This marketing link is already associated with another account.") };
  }
  if (marketingLink.account_user_id === user.id) {
    return recordMarketingEvent(marketingLink.id, "account_linked", {
      wasNewAccount: false,
    });
  }

  const wasNewAccount =
    new Date(user.created_at).getTime() >= new Date(marketingLink.created_at).getTime() - 5 * 60 * 1000;
  const { data: updated, error: updateError } = await supabase
    .from("marketing_links")
    .update({
      account_user_id: user.id,
      account_linked_at: new Date().toISOString(),
      account_was_created: wasNewAccount,
    })
    .eq("id", marketingLink.id)
    .is("account_user_id", null)
    .select("id")
    .maybeSingle();
  if (updateError || !updated) {
    return { error: updateError ?? new Error("Marketing account attribution changed concurrently.") };
  }

  return recordMarketingEvent(marketingLink.id, "account_linked", { wasNewAccount });
}

export type MarketingPreview = {
  id: string;
  label: string;
  url: string;
};

export const MARKETING_PREVIEW_BUCKET = "marketing-previews";

export async function getMarketingPreviewUrls(
  sourceHash: string,
  expiresAt: string,
): Promise<MarketingPreview[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase || !/^[a-f0-9]{64}$/i.test(sourceHash)) return [];

  const expiresIn = Math.max(
    60,
    Math.min(7 * 24 * 60 * 60, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)),
  );
  const paths = MOCKUP_PREVIEW_IDS.map((preview) => ({
    ...preview,
    path: `${sourceHash.toLowerCase()}/${preview.id}.webp`,
  }));
  const { data, error } = await supabase.storage
    .from(MARKETING_PREVIEW_BUCKET)
    .createSignedUrls(paths.map((preview) => preview.path), expiresIn);
  if (error || !data) return [];
  const previews = data.flatMap((signed, index) =>
    signed.signedUrl
      ? [{ id: paths[index].id, label: paths[index].label, url: signed.signedUrl }]
      : [],
  );
  return previews.length === paths.length ? previews : [];
}

export const MOCKUP_PREVIEW_IDS = [
  { id: "pillow-psd-03-grey-sofa", label: "Grey sofa close-up" },
  { id: "pillow-psd-04-size", label: "18in / 45cm size" },
  { id: "pillow-psd-06-wood-chair", label: "Wood chair" },
  { id: "pillow-psd-01", label: "Sofa room" },
] as const;

export async function recordMarketingEvent(
  marketingLinkId: string,
  eventType: MarketingEventType,
  metadata: Record<string, unknown> = {},
  orderId?: string,
) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return { error: new Error("Marketing storage is not configured.") };

  return supabase.from("marketing_events").upsert(
    {
      marketing_link_id: marketingLinkId,
      event_type: eventType,
      metadata,
      order_id: orderId ?? null,
    },
    { onConflict: "marketing_link_id,event_type", ignoreDuplicates: true },
  );
}
