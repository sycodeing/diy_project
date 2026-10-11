import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isAuthorizedXLeadWorker } from "@/lib/x-lead-worker-auth";

export const runtime = "nodejs";

const requestSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  cookieConfigured: z.boolean(),
  version: z.string().trim().min(1).max(40).optional(),
});

export async function POST(request: Request) {
  if (!isAuthorizedXLeadWorker(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid worker heartbeat." }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const now = new Date().toISOString();
  const { error: heartbeatError } = await supabase.from("x_lead_workers").upsert({
    worker_id: parsed.data.workerId,
    status: parsed.data.cookieConfigured ? "online" : "paused",
    cookie_configured: parsed.data.cookieConfigured,
    worker_version: parsed.data.version ?? null,
    last_error: parsed.data.cookieConfigured ? null : "尚未在本机导入 X Cookie。",
    last_seen_at: now,
  }, { onConflict: "worker_id" });
  if (heartbeatError) return NextResponse.json({ error: heartbeatError.message }, { status: 500 });
  if (!parsed.data.cookieConfigured) return new Response(null, { status: 204 });

  // A worker can disappear after claiming a job (machine shutdown, expired
  // process, network loss). Return stale work to the queue so it is not lost.
  const staleBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { error: recoveryError } = await supabase
    .from("x_lead_search_jobs")
    .update({
      status: "queued",
      worker_id: null,
      started_at: null,
      error_code: "stale_worker_recovered",
      error_message: "本地执行器超过 60 分钟未完成，任务已自动重新排队。",
    })
    .eq("status", "running")
    .lt("started_at", staleBefore);
  if (recoveryError) return NextResponse.json({ error: recoveryError.message }, { status: 500 });

  const { data: queued, error: readError } = await supabase
    .from("x_lead_search_jobs")
    .select("id,configuration,trigger_type,created_at")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!queued) return new Response(null, { status: 204 });

  const { data: claimed, error: claimError } = await supabase
    .from("x_lead_search_jobs")
    .update({
      status: "running",
      worker_id: parsed.data.workerId,
      started_at: now,
      error_code: null,
      error_message: null,
    })
    .eq("id", queued.id)
    .eq("status", "queued")
    .select("id,configuration,trigger_type,created_at")
    .maybeSingle();
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!claimed) return new Response(null, { status: 204 });

  await supabase.from("x_lead_workers").update({ status: "busy", last_seen_at: now }).eq("worker_id", parsed.data.workerId);
  return NextResponse.json({ job: claimed });
}

