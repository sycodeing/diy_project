import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isAuthorizedXReplyWorker } from "@/lib/x-reply-worker-auth";

export const runtime = "nodejs";

const requestSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  jobId: z.string().uuid(),
  accountKey: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  egressIp: z.string().trim().max(64).refine((value) => isIP(value) !== 0),
});

export async function POST(request: Request) {
  if (!isAuthorizedXReplyWorker(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid proxy verification." }, { status: 400 });
  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const { data: job, error: jobError } = await supabase.from("x_reply_jobs")
    .select("id,status,worker_id,account_id,x_reply_accounts!inner(account_key)")
    .eq("id", parsed.data.jobId)
    .maybeSingle();
  const account = job && (Array.isArray(job.x_reply_accounts) ? job.x_reply_accounts[0] : job.x_reply_accounts);
  if (jobError || !job || job.status !== "claimed" || job.worker_id !== parsed.data.workerId || account?.account_key !== parsed.data.accountKey) {
    return NextResponse.json({ error: "The claimed job does not belong to this worker and account." }, { status: 409 });
  }

  const testedAt = new Date().toISOString();
  const { data: updated, error } = await supabase.from("x_reply_account_proxies").update({
    status: "healthy",
    egress_ip: parsed.data.egressIp,
    last_tested_at: testedAt,
    last_error: null,
  }).eq("account_id", job.account_id).select("account_id").maybeSingle();
  if (error?.code === "23505") {
    await supabase.from("x_reply_account_proxies").update({
      status: "error",
      egress_ip: null,
      last_tested_at: testedAt,
      last_error: "该出口 IP 已绑定其他 X 账号，已阻止发送。",
    }).eq("account_id", job.account_id);
    return NextResponse.json({ error: "This egress IP is already assigned to another X account." }, { status: 409 });
  }
  if (error || !updated) return NextResponse.json({ error: error?.message ?? "Proxy configuration not found." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
