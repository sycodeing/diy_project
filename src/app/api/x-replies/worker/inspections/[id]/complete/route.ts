import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isAuthorizedXReplyWorker } from "@/lib/x-reply-worker-auth";

export const runtime = "nodejs";

const requestSchema = z.object({
  executorId: z.string().trim().min(1).max(120),
  actualHandle: z.string().trim().regex(/^[A-Za-z0-9_]{1,15}$/).nullable().optional(),
  egressIp: z.string().trim().max(64).refine((value) => isIP(value) !== 0).nullable().optional(),
  errorCode: z.string().trim().max(100).nullable().optional(),
  errorMessage: z.string().trim().max(1000).nullable().optional(),
});

export async function POST(
  request: Request,
  context: RouteContext<"/api/x-replies/worker/inspections/[id]/complete">,
) {
  if (!isAuthorizedXReplyWorker(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await context.params;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid inspection result." }, { status: 400 });
  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const { data: job, error: readError } = await supabase.from("x_reply_jobs")
    .select("id,inspection_status,inspection_executor_id,x_reply_accounts!inner(id,expected_x_handle,network_mode,expected_egress_ip,x_reply_account_proxies(egress_ip))")
    .eq("id", id)
    .maybeSingle();
  if (readError || !job) return NextResponse.json({ error: readError?.message ?? "Inspection not found." }, { status: 404 });
  if (job.inspection_status !== "running" || job.inspection_executor_id !== parsed.data.executorId) {
    return NextResponse.json({ error: "Inspection is not owned by this worker." }, { status: 409 });
  }

  const accountRelation = job.x_reply_accounts;
  const account = Array.isArray(accountRelation) ? accountRelation[0] : accountRelation;
  const proxyRelation = account?.x_reply_account_proxies;
  const proxy = Array.isArray(proxyRelation) ? proxyRelation[0] : proxyRelation;
  const actualHandle = parsed.data.actualHandle ?? null;
  const egressIp = parsed.data.egressIp ?? null;
  const expectedHandle = String(account?.expected_x_handle ?? "");
  const expectedEgressIp = account?.network_mode === "fixed_proxy"
    ? String(proxy?.egress_ip ?? "")
    : String(account?.expected_egress_ip ?? "");
  let errorMessage = parsed.data.errorMessage ?? null;
  if (!errorMessage && (!actualHandle || actualHandle.toLowerCase() !== expectedHandle.toLowerCase())) {
    errorMessage = `实际登录账号 @${actualHandle ?? "未识别"} 与期望 @${expectedHandle || "未配置"} 不一致。`;
  }
  if (!errorMessage && (!egressIp || egressIp !== expectedEgressIp)) {
    errorMessage = `实际出口 ${egressIp ?? "未识别"} 与该账号绑定出口 ${expectedEgressIp || "未配置"} 不一致。`;
  }

  const routeFailed = parsed.data.errorCode === "proxy_ip_unconfirmed"
    || parsed.data.errorCode === "network_route_mismatch"
    || Boolean(egressIp && expectedEgressIp && egressIp !== expectedEgressIp);
  if (errorMessage && routeFailed && account?.network_mode === "fixed_proxy") {
    await supabase.from("x_reply_account_proxies").update({
      status: "error",
      last_tested_at: new Date().toISOString(),
      last_error: errorMessage,
    }).eq("account_id", account.id);
  }

  const completedAt = new Date().toISOString();
  const passed = !errorMessage && Boolean(actualHandle && egressIp);
  const { error: updateError } = await supabase.from("x_reply_jobs").update({
    inspection_status: passed ? "completed" : "failed",
    inspection_completed_at: completedAt,
    inspection_error: errorMessage,
  }).eq("id", job.id).eq("inspection_status", "running")
    .eq("inspection_executor_id", parsed.data.executorId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await supabase.from("x_reply_workers").update({
    last_error: errorMessage,
    last_seen_at: completedAt,
  }).eq("executor_id", parsed.data.executorId);
  return NextResponse.json({ ok: true, passed });
}
