import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isAuthorizedXReplyWorker } from "@/lib/x-reply-worker-auth";

export const runtime = "nodejs";

const requestSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  xUseAvailable: z.boolean(),
  configuredAccounts: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(50),
  version: z.string().trim().min(1).max(40).optional(),
  errorMessage: z.string().trim().max(1000).nullable().optional(),
});

export async function POST(request: Request) {
  if (!isAuthorizedXReplyWorker(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid worker heartbeat." }, { status: 400 });
  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const now = new Date().toISOString();
  const available = parsed.data.xUseAvailable && parsed.data.configuredAccounts.length > 0;
  const { error: heartbeatError } = await supabase.from("x_reply_workers").upsert({
    worker_id: parsed.data.workerId,
    status: available ? "online" : "paused",
    xuse_available: parsed.data.xUseAvailable,
    configured_accounts: parsed.data.configuredAccounts,
    current_job_id: null,
    worker_version: parsed.data.version ?? null,
    last_error: parsed.data.errorMessage ?? (available ? null : "x-use 尚未配置可用账号。"),
    last_seen_at: now,
  }, { onConflict: "worker_id" });
  if (heartbeatError) return NextResponse.json({ error: heartbeatError.message }, { status: 500 });

  // A claimed write can already have reached X before the worker disappeared.
  // Never return stale writes to the queue; force a human reconciliation.
  const staleBefore = new Date(Date.now() - 30 * 60_000).toISOString();
  const { error: staleError } = await supabase.from("x_reply_jobs").update({
    status: "uncertain",
    completed_at: now,
    error_code: "worker_disappeared",
    error_message: "本机执行器领取任务后超过 30 分钟未回报。请先到 X 核对，禁止自动重试。",
  }).eq("status", "claimed").lt("claimed_at", staleBefore);
  if (staleError) return NextResponse.json({ error: staleError.message }, { status: 500 });
  if (!available) return new Response(null, { status: 204 });

  const { data: accounts, error: accountsError } = await supabase
    .from("x_reply_accounts")
    .select("id,account_key")
    .eq("active", true)
    .in("account_key", parsed.data.configuredAccounts);
  if (accountsError) return NextResponse.json({ error: accountsError.message }, { status: 500 });
  if (!accounts?.length) return new Response(null, { status: 204 });
  const accountKeys = new Map(accounts.map((account) => [account.id, account.account_key]));

  const { data: queued, error: readError } = await supabase
    .from("x_reply_jobs")
    .select("id,account_id,action_type,target_post_url,reply_text,scheduled_for,created_at")
    .eq("status", "queued")
    .eq("attempt_count", 0)
    .lte("scheduled_for", now)
    .in("account_id", accounts.map((account) => account.id))
    .order("scheduled_for", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!queued) return new Response(null, { status: 204 });

  const { data: claimed, error: claimError } = await supabase.from("x_reply_jobs").update({
    status: "claimed",
    worker_id: parsed.data.workerId,
    claimed_at: now,
    attempt_count: 1,
    error_code: null,
    error_message: null,
  }).eq("id", queued.id).eq("status", "queued").eq("attempt_count", 0)
    .lte("scheduled_for", now)
    .select("id,account_id,action_type,target_post_url,reply_text,scheduled_for,created_at")
    .maybeSingle();
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!claimed) return new Response(null, { status: 204 });

  await supabase.from("x_reply_workers").update({ status: "busy", current_job_id: claimed.id, last_seen_at: now }).eq("worker_id", parsed.data.workerId);
  return NextResponse.json({ job: {
    id: claimed.id,
    accountKey: accountKeys.get(claimed.account_id),
    actionType: claimed.action_type,
    targetPostUrl: claimed.target_post_url,
    postText: claimed.reply_text,
  } });
}
