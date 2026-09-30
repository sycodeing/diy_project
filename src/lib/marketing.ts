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
    .select("id,expires_at")
    .eq("token_hash", hashMarketingToken(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  return data ?? null;
}

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
