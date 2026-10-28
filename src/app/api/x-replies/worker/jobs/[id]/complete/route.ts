import { NextResponse } from "next/server";
import { isIP } from "node:net";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isAuthorizedXReplyWorker } from "@/lib/x-reply-worker-auth";

export const runtime = "nodejs";

const requestSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  status: z.enum(["sent", "failed", "uncertain"]),
  xUseDraftId: z.string().trim().max(120).nullable().optional(),
  actionId: z.string().trim().max(160).nullable().optional(),
  resultUrl: z.string().url().max(2048).refine((value) => /^https:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(value)).nullable().optional(),
  errorCode: z.string().trim().max(100).nullable().optional(),
  errorMessage: z.string().trim().max(1000).nullable().optional(),
  egressIp: z.string().trim().max(64).refine((value) => isIP(value) !== 0).nullable().optional(),
});

export async function POST(request: Request, context: RouteContext<"/api/x-replies/worker/jobs/[id]/complete">) {
  if (!isAuthorizedXReplyWorker(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await context.params;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid worker result." }, { status: 400 });
  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const { data: job, error: readError } = await supabase.from("x_reply_jobs")
    .select("id,status,worker_id,account_id")
    .eq("id", id)
    .maybeSingle();
  if (readError || !job) return NextResponse.json({ error: readError?.message ?? "Job not found." }, { status: 404 });
  if (job.status !== "claimed" || job.worker_id !== parsed.data.workerId) {
    return NextResponse.json({ error: "Job is not owned by this worker." }, { status: 409 });
  }

  const completedAt = new Date().toISOString();
  const { error: updateError } = await supabase.from("x_reply_jobs").update({
    status: parsed.data.status,
    xuse_draft_id: parsed.data.xUseDraftId ?? null,
    action_id: parsed.data.actionId ?? null,
    result_url: parsed.data.resultUrl ?? null,
    error_code: parsed.data.errorCode ?? null,
    error_message: parsed.data.errorMessage ?? null,
    completed_at: completedAt,
  }).eq("id", id).eq("status", "claimed").eq("worker_id", parsed.data.workerId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  if (!parsed.data.egressIp) {
    await supabase.from("x_reply_account_proxies").update({
      status: "error",
      egress_ip: null,
      last_tested_at: completedAt,
      last_error: parsed.data.errorMessage ?? "代理校验失败。",
    }).eq("account_id", job.account_id);
  }

  if (parsed.data.status === "sent") {
    await supabase.from("x_reply_daily_gates").update({ first_sent_at: completedAt })
      .eq("account_id", job.account_id).eq("first_job_id", job.id).eq("status", "awaiting_confirmation");
  } else if (parsed.data.status === "failed") {
    await supabase.from("x_reply_daily_gates").update({ status: "pending", first_job_id: null, first_sent_at: null })
      .eq("account_id", job.account_id).eq("first_job_id", job.id).eq("status", "awaiting_confirmation");
  } else {
    await supabase.from("x_reply_daily_gates").update({ status: "paused" })
      .eq("account_id", job.account_id).eq("first_job_id", job.id).eq("status", "awaiting_confirmation");
  }

  await supabase.from("x_reply_workers").update({
    status: parsed.data.status === "failed" ? "error" : "online",
    current_job_id: null,
    last_error: parsed.data.errorMessage ?? null,
    last_seen_at: completedAt,
  }).eq("worker_id", parsed.data.workerId);
  return NextResponse.json({ ok: true });
}
