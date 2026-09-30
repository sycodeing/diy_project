import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const now = new Date().toISOString();
  const nonceCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ count: cleared, error }, { error: nonceError }] = await Promise.all([
    supabase
      .from("marketing_links")
      .update({ source_image_url: null }, { count: "exact" })
      .lte("expires_at", now)
      .not("source_image_url", "is", null),
    supabase.from("marketing_ingest_nonces").delete().lt("created_at", nonceCutoff),
  ]);

  if (error || nonceError) {
    return NextResponse.json({ error: error?.message ?? nonceError?.message }, { status: 500 });
  }
  return NextResponse.json({ clearedImageUrls: cleared ?? 0 });
}
