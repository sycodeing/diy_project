import { NextResponse } from "next/server";
import { MARKETING_PREVIEW_BUCKET, MOCKUP_PREVIEW_IDS } from "@/lib/marketing";
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
  const { data: expiredLinks, error: expiredError } = await supabase
    .from("marketing_links")
    .select("id,source_hash")
    .lte("expires_at", now)
    .not("source_image_url", "is", null)
    .limit(500);
  if (expiredError) {
    return NextResponse.json({ error: expiredError.message }, { status: 500 });
  }

  const hashes = [...new Set((expiredLinks ?? []).map((link) => link.source_hash))];
  if (hashes.length) {
    const { data: activeLinks, error: activeError } = await supabase
      .from("marketing_links")
      .select("source_hash")
      .gt("expires_at", now)
      .in("source_hash", hashes);
    if (activeError) {
      return NextResponse.json({ error: activeError.message }, { status: 500 });
    }

    const activeHashes = new Set((activeLinks ?? []).map((link) => link.source_hash));
    const expiredHashes = hashes.filter((hash) => !activeHashes.has(hash));
    if (expiredHashes.length) {
      const paths = expiredHashes.flatMap((hash) =>
        MOCKUP_PREVIEW_IDS.map((preview) => `${hash}/${preview.id}.webp`),
      );
      const { error: storageError } = await supabase.storage
        .from(MARKETING_PREVIEW_BUCKET)
        .remove(paths);
      if (storageError && !/bucket not found|does not exist/i.test(storageError.message)) {
        return NextResponse.json({ error: storageError.message }, { status: 500 });
      }
    }
  }

  const expiredIds = (expiredLinks ?? []).map((link) => link.id);
  const [{ count: cleared, error }, { error: nonceError }] = await Promise.all([
    expiredIds.length
      ? supabase
          .from("marketing_links")
          .update({ source_image_url: null }, { count: "exact" })
          .in("id", expiredIds)
          .not("source_image_url", "is", null)
      : Promise.resolve({ count: 0, error: null }),
    supabase.from("marketing_ingest_nonces").delete().lt("created_at", nonceCutoff),
  ]);

  if (error || nonceError) {
    return NextResponse.json({ error: error?.message ?? nonceError?.message }, { status: 500 });
  }
  return NextResponse.json({ clearedImageUrls: cleared ?? 0 });
}
