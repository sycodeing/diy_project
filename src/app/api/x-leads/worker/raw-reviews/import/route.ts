import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isAuthorizedXLeadWorker } from "@/lib/x-lead-worker-auth";
import { keepResolvedParentEvidence, preserveOmittedRawPhotos, toRawReviewRow, xLeadRawReviewSchema } from "@/lib/x-lead-raw-review";

export const runtime = "nodejs";

const requestSchema = z.object({ rawCandidates: z.array(xLeadRawReviewSchema).min(1).max(200) });

export async function POST(request: Request) {
  if (!isAuthorizedXLeadWorker(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid raw review import." }, { status: 400 });
  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const incoming = parsed.data.rawCandidates.map((candidate) => toRawReviewRow(candidate));
  const { data: existing, error: existingError } = await supabase.from("x_lead_raw_reviews")
    .select("post_id,parent_status,parent_evidence,parent_source_archive,review_status,reviewed_by,reviewed_at,first_seen_at,photo_urls")
    .in("post_id", incoming.map((row) => row.post_id));
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  const byId = new Map((existing ?? []).map((row) => [row.post_id, row]));
  const rows = preserveOmittedRawPhotos(keepResolvedParentEvidence(incoming, existing ?? []), existing ?? []).map((row) => ({
    ...row,
    review_status: byId.get(row.post_id)?.review_status ?? "unreviewed",
    reviewed_by: byId.get(row.post_id)?.reviewed_by ?? null,
    reviewed_at: byId.get(row.post_id)?.reviewed_at ?? null,
    first_seen_at: byId.get(row.post_id)?.first_seen_at ?? row.last_seen_at,
  }));
  const { error } = await supabase.from("x_lead_raw_reviews").upsert(rows, { onConflict: "post_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, reviewedRawPosts: rows.length });
}
