import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/env";
import {
  MARKETING_ATTRIBUTION_SECONDS,
  MARKETING_COOKIE_NAME,
  MARKETING_VISIT_COOKIE_NAME,
  MARKETING_VISIT_SECONDS,
  hashMarketingToken,
} from "@/lib/marketing";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { classifyTraffic } from "@/lib/traffic-classification";

export async function handleMarketingRedirect(request: Request, token: string, shortAlias = false) {
  const supabase = getSupabaseServiceClient();
  const fallback = new URL("/design", getAppUrl());
  if (!supabase || !/^[a-zA-Z0-9_-]{10,64}$/.test(token)) {
    return NextResponse.redirect(fallback);
  }

  const now = new Date();
  let linkQuery = supabase
    .from("marketing_links")
    .select("id,source_image_url,expires_at")
    .gt("expires_at", now.toISOString());
  linkQuery = shortAlias
    ? linkQuery.eq("short_token_hash", hashMarketingToken(token))
    : linkQuery.eq("token_hash", hashMarketingToken(token));
  const { data: link } = await linkQuery
    .maybeSingle();
  if (!link) return NextResponse.redirect(fallback);

  const traffic = classifyTraffic(request.headers, new URL(request.url).origin);
  const isInternal = /(?:^|;\s*)diy_internal_test=1(?:;|$)/.test(request.headers.get("cookie") ?? "");
  const visitId = randomUUID();
  const { error: visitError } = await supabase.rpc("record_marketing_link_click_v2", {
    p_visit_id: visitId,
    p_link_id: link.id,
    p_device_class: traffic.deviceClass,
    p_referrer_group: traffic.referrerGroup,
    p_suspected_bot: traffic.suspectedBot,
    p_is_internal: isInternal,
  });
  if (visitError) console.error("Marketing redirect visit could not be recorded", { error: visitError.message });
  const destination = new URL("/design", getAppUrl());
  if (link.source_image_url) destination.searchParams.set("image", link.source_image_url);

  const expires = new Date(
    Math.min(
      new Date(link.expires_at).getTime(),
      now.getTime() + MARKETING_ATTRIBUTION_SECONDS * 1000,
    ),
  );
  const response = NextResponse.redirect(destination);
  response.cookies.set(MARKETING_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
  if (!visitError) response.cookies.set(MARKETING_VISIT_COOKIE_NAME, visitId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MARKETING_VISIT_SECONDS,
  });
  else response.cookies.set(MARKETING_VISIT_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
