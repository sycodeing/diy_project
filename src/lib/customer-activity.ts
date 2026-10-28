import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const ACTIVITY_SESSION_COOKIE = "diy_activity_session";
export const ACTIVITY_SESSION_SECONDS = 7 * 24 * 60 * 60;

export type CustomerActivityEventType =
  | "page_view" | "page_exit" | "click" | "landing_confirmed" | "design_opened" | "upload_started"
  | "crop_confirmed" | "preview_started" | "preview_cache_hit" | "preview_ready"
  | "delivery_opened" | "delivery_canceled" | "address_validation_failed"
  | "checkout_started" | "payment_redirected" | "purchase_completed";

export async function getOrCreateActivitySessionId() {
  const cookieStore = await cookies();
  const existing = cookieStore.get(ACTIVITY_SESSION_COOKIE)?.value;
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;

  const sessionId = randomUUID();
  cookieStore.set(ACTIVITY_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    maxAge: ACTIVITY_SESSION_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return sessionId;
}

export async function recordCustomerActivity({
  sessionId,
  eventType,
  route,
  target = null,
  durationSeconds = 0,
  eventKey,
  orderId = null,
  marketingLinkId = null,
  deviceClass = "unknown",
  referrerGroup = "direct",
  suspectedBot = false,
  isInternal = false,
}: {
  sessionId: string;
  eventType: CustomerActivityEventType;
  route: string;
  target?: string | null;
  durationSeconds?: number;
  eventKey: string;
  orderId?: string | null;
  marketingLinkId?: string | null;
  deviceClass?: "desktop" | "mobile" | "tablet" | "unknown";
  referrerGroup?: "direct" | "internal" | "search" | "x" | "other";
  suspectedBot?: boolean;
  isInternal?: boolean;
}) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return { error: new Error("Analytics storage is not configured.") };
  return supabase.from("customer_activity_events").upsert(
    {
      session_id: sessionId,
      event_type: eventType,
      route,
      target,
      duration_seconds: durationSeconds,
      event_key: eventKey,
      order_id: orderId,
      marketing_link_id: marketingLinkId,
      device_class: deviceClass,
      referrer_group: referrerGroup,
      suspected_bot: suspectedBot,
      is_internal: isInternal,
    },
    { onConflict: "event_key", ignoreDuplicates: true },
  );
}
