import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/env";
import {
  MARKETING_ATTRIBUTION_SECONDS,
  MARKETING_COOKIE_NAME,
  hashMarketingToken,
} from "@/lib/marketing";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const supabase = getSupabaseServiceClient();
  const fallback = new URL("/design", getAppUrl());
  if (!supabase || !/^[a-zA-Z0-9_-]{43,64}$/.test(token)) {
    return NextResponse.redirect(fallback);
  }

  const now = new Date();
  const { data: link } = await supabase
    .from("marketing_links")
    .select("id,source_image_url,expires_at")
    .eq("token_hash", hashMarketingToken(token))
    .gt("expires_at", now.toISOString())
    .maybeSingle();
  if (!link) return NextResponse.redirect(fallback);

  await supabase.rpc("record_marketing_link_click", { p_link_id: link.id });
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
  return response;
}
