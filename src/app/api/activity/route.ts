import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ACTIVITY_SESSION_COOKIE,
  ACTIVITY_SESSION_SECONDS,
  recordCustomerActivity,
} from "@/lib/customer-activity";
import { getActiveMarketingLinkFromCookie, markMarketingVisitStage, recordMarketingEvent } from "@/lib/marketing";
import { classifyTraffic } from "@/lib/traffic-classification";

const clientEventTypes = [
  "page_view", "page_exit", "click", "landing_confirmed", "design_opened", "upload_started",
  "crop_confirmed", "preview_started", "preview_cache_hit", "preview_ready",
  "delivery_opened", "delivery_canceled", "address_validation_failed",
  "payment_redirected",
] as const;

const schema = z.object({
  eventId: z.string().uuid(),
  eventType: z.enum(clientEventTypes),
  route: z.string().min(1).max(160).regex(/^\/[a-zA-Z0-9:_./-]*$/),
  target: z.string().regex(/^[a-z0-9:_-]{1,64}$/i).optional(),
  durationSeconds: z.number().int().min(0).max(3600).optional(),
  referrerGroup: z.enum(["direct", "internal", "search", "x", "other"]).optional(),
});

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 2048) {
    return NextResponse.json({ error: "Activity event is too large." }, { status: 413 });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Invalid activity event." }, { status: 400 });
  if (parsed.data.route.startsWith("/admin") || parsed.data.route.startsWith("/api")) {
    return new NextResponse(null, { status: 204 });
  }

  const existing = request.headers.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ACTIVITY_SESSION_COOKIE}=`))
    ?.slice(ACTIVITY_SESSION_COOKIE.length + 1);
  let decoded = "";
  try { decoded = existing ? decodeURIComponent(existing) : ""; } catch { decoded = ""; }
  const sessionId = /^[0-9a-f-]{36}$/i.test(decoded) ? decoded : randomUUID();
  const { eventId, eventType, route, target, durationSeconds, referrerGroup } = parsed.data;
  const traffic = classifyTraffic(request.headers, new URL(request.url).origin);
  const isInternal = /(?:^|;\s*)diy_internal_test=1(?:;|$)/.test(request.headers.get("cookie") ?? "");
  const marketingLink = await getActiveMarketingLinkFromCookie();
  const { error } = await recordCustomerActivity({
    sessionId,
    eventType,
    route,
    target: target ?? (eventType === "click" ? "button" : null),
    durationSeconds: eventType === "page_exit" ? durationSeconds ?? 0 : 0,
    eventKey: `client:${sessionId}:${eventId}`,
    marketingLinkId: marketingLink?.id ?? null,
    ...traffic,
    referrerGroup: referrerGroup ?? traffic.referrerGroup,
    isInternal,
  });
  if (error) {
    console.error("Customer activity could not be recorded", { error: error.message });
    return NextResponse.json({ error: "Could not record activity." }, { status: 503 });
  }
  if (marketingLink && route === "/design") {
    const stage = eventType === "landing_confirmed" ? "browser_confirmed_at"
      : eventType === "click" || eventType === "upload_started" || eventType === "crop_confirmed" || eventType === "delivery_opened"
        ? "first_interaction_at" : null;
    if (stage) {
      const { error: visitError } = await markMarketingVisitStage(marketingLink.id, stage);
      if (visitError) console.error("Marketing visit stage could not be recorded", { stage, error: visitError.message });
    }
  }
  if (eventType === "landing_confirmed" && marketingLink) {
    const { error: marketingError } = await recordMarketingEvent(
      marketingLink.id,
      "landing_confirmed",
      {},
      undefined,
      sessionId,
      isInternal,
    );
    if (marketingError) {
      console.error("Browser-confirmed landing could not be recorded", { error: marketingError.message });
      return NextResponse.json({ error: "Could not record marketing landing." }, { status: 503 });
    }
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(ACTIVITY_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    maxAge: ACTIVITY_SESSION_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
