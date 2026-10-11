import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isAuthorizedXLeadWorker } from "@/lib/x-lead-worker-auth";

export const runtime = "nodejs";

const candidateSchema = z.object({
  postId: z.string().trim().min(1).max(100),
  authorHash: z.string().regex(/^[a-f0-9]{64}$/),
  handle: z.string().trim().regex(/^[A-Za-z0-9_]{1,50}$/),
  postUrl: z.url().max(2048).refine((value) => /^https:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(value)),
  mediaUrl: z.url().max(2048).refine((value) => value.startsWith("https://")),
  postedAt: z.string().datetime({ offset: true }).nullable().optional(),
  selectionStatus: z.enum(["new", "location_review", "targeting_review", "rejected_targeting"]),
  segment: z.enum(["new_adoption", "pet_birthday", "custom"]),
  occasion: z.string().max(60).nullable().optional(),
  occasionConfidence: z.number().int().min(0).max(100).nullable().optional(),
  ownershipConfidence: z.number().int().min(0).max(100).nullable().optional(),
  usConfidence: z.number().int().min(0).max(100).nullable().optional(),
  usEvidence: z.string().max(200).nullable().optional(),
  leadScore: z.number().int().min(0).max(100).nullable().optional(),
  likeCount: z.number().int().min(0).default(0),
  replyCount: z.number().int().min(0).default(0),
  repostCount: z.number().int().min(0).default(0),
  viewCount: z.number().int().min(0).default(0),
  followersCount: z.number().int().min(0).default(0),
  targetingData: z.record(z.string(), z.unknown()).default({}),
  consentCopy: z.string().max(1500).nullable().optional(),
  publicCopy: z.string().max(1500).nullable().optional(),
  directMessageCopy: z.string().max(1500).nullable().optional(),
});

const requestSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  status: z.enum(["completed", "failed", "blocked"]),
  receivedCount: z.number().int().min(0).max(1000),
  errorCode: z.string().trim().max(80).nullable().optional(),
  errorMessage: z.string().trim().max(1000).nullable().optional(),
  candidates: z.array(candidateSchema).max(100).default([]),
});

export async function POST(request: Request, context: RouteContext<"/api/x-leads/worker/jobs/[id]/complete">) {
  if (!isAuthorizedXLeadWorker(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id } = await context.params;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid worker result." }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: job, error: jobError } = await supabase
    .from("x_lead_search_jobs")
    .select("id,status,worker_id")
    .eq("id", id)
    .maybeSingle();
  if (jobError || !job) return NextResponse.json({ error: jobError?.message ?? "Job not found." }, { status: 404 });
  if (job.status !== "running" || job.worker_id !== parsed.data.workerId) {
    return NextResponse.json({ error: "Job is not owned by this worker." }, { status: 409 });
  }

  let insertedCount = 0;
  if (parsed.data.status === "completed" && parsed.data.candidates.length) {
    const postIds = parsed.data.candidates.map((candidate) => candidate.postId);
    const { data: existing, error: existingError } = await supabase
      .from("x_leads")
      .select("post_id")
      .in("post_id", postIds);
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
    const existingIds = new Set((existing ?? []).map((lead) => lead.post_id));
    insertedCount = postIds.filter((postId) => !existingIds.has(postId)).length;

    const rows = parsed.data.candidates.map((candidate) => ({
      source_job_id: id,
      post_id: candidate.postId,
      author_hash: candidate.authorHash,
      x_handle: candidate.handle,
      post_url: candidate.postUrl,
      media_url: candidate.mediaUrl,
      posted_at: candidate.postedAt ?? null,
      discovered_at: new Date().toISOString(),
      selection_status: candidate.selectionStatus,
      segment: candidate.segment,
      occasion: candidate.occasion ?? null,
      occasion_confidence: candidate.occasionConfidence ?? null,
      ownership_confidence: candidate.ownershipConfidence ?? null,
      us_confidence: candidate.usConfidence ?? null,
      us_evidence: candidate.usEvidence ?? null,
      lead_score: candidate.leadScore ?? null,
      like_count: candidate.likeCount,
      reply_count: candidate.replyCount,
      repost_count: candidate.repostCount,
      view_count: candidate.viewCount,
      followers_count: candidate.followersCount,
      targeting_data: candidate.targetingData,
      consent_copy: candidate.consentCopy ?? null,
      public_copy: candidate.publicCopy ?? null,
      direct_message_copy: candidate.directMessageCopy ?? null,
    }));
    const { error: upsertError } = await supabase.from("x_leads").upsert(rows, { onConflict: "post_id" });
    if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  const finishedAt = new Date().toISOString();
  const { error: finishError } = await supabase
    .from("x_lead_search_jobs")
    .update({
      status: parsed.data.status,
      received_count: parsed.data.receivedCount,
      inserted_count: insertedCount,
      error_code: parsed.data.errorCode ?? null,
      error_message: parsed.data.errorMessage ?? null,
      finished_at: finishedAt,
    })
    .eq("id", id)
    .eq("worker_id", parsed.data.workerId);
  if (finishError) return NextResponse.json({ error: finishError.message }, { status: 500 });

  await supabase.from("x_lead_workers").update({
    status: parsed.data.status === "blocked" ? "error" : "online",
    last_error: parsed.data.errorMessage ?? null,
    last_seen_at: finishedAt,
  }).eq("worker_id", parsed.data.workerId);
  return NextResponse.json({ ok: true, insertedCount });
}

