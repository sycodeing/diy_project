import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isAuthorizedXReplyWorker } from "@/lib/x-reply-worker-auth";

export const runtime = "nodejs";

const requestSchema = z.object({
  executorId: z.string().trim().min(1).max(120),
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
    .select("id,status,worker_id,account_id,x_reply_accounts!inner(account_key,executor_id,network_mode,expected_egress_ip)")
    .eq("id", parsed.data.jobId)
    .maybeSingle();
  const account = job && (Array.isArray(job.x_reply_accounts) ? job.x_reply_accounts[0] : job.x_reply_accounts);
  if (jobError || !job || job.status !== "claimed" || job.worker_id !== parsed.data.executorId
    || account?.account_key !== parsed.data.accountKey || account.executor_id !== parsed.data.executorId) {
    return NextResponse.json({ error: "The claimed job does not belong to this worker and account." }, { status: 409 });
  }

  const testedAt = new Date().toISOString();
  if (account.network_mode === "vpn_direct") {
    if (!account.expected_egress_ip || String(account.expected_egress_ip) !== parsed.data.egressIp) {
      await supabase.from("x_reply_workers").update({
        current_egress_ip: parsed.data.egressIp,
        network_probe_status: "mismatch",
        last_error: "Patchright 浏览器出口与管理员锁定的 VPN IP 不一致。",
        last_seen_at: testedAt,
      }).eq("executor_id", parsed.data.executorId);
      return NextResponse.json({ error: "The Patchright browser egress does not match the administrator-locked VPN IP." }, { status: 409 });
    }
    await supabase.from("x_reply_workers").update({
      current_egress_ip: parsed.data.egressIp,
      network_probe_status: "healthy",
      last_error: null,
      last_seen_at: testedAt,
    }).eq("executor_id", parsed.data.executorId);
    return NextResponse.json({ ok: true });
  }
  if (account.network_mode !== "fixed_proxy") {
    return NextResponse.json({ error: "The account network mode is invalid." }, { status: 409 });
  }
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
