import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isAuthorizedXReplyWorker } from "@/lib/x-reply-worker-auth";
import { isBoundProxyEgress } from "@/lib/x-reply-safety";

export const runtime = "nodejs";

const requestSchema = z.object({
  executorId: z.string().trim().min(1).max(120),
  actualHandle: z.string().trim().regex(/^[A-Za-z0-9_]{1,15}$/).nullable().optional(),
  egressIp: z.string().trim().max(64).refine((value) => isIP(value) !== 0).nullable().optional(),
  errorCode: z.string().trim().max(100).nullable().optional(),
  errorMessage: z.string().trim().max(1000).nullable().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedXReplyWorker(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await context.params;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid verification result." }, { status: 400 });
  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const { data: account, error: readError } = await supabase.from("x_reply_accounts")
    .select("id,account_key,expected_x_handle,executor_id,network_mode,expected_egress_ip,verification_status,x_reply_account_proxies(egress_ip)")
    .eq("id", id)
    .maybeSingle();
  if (readError || !account) return NextResponse.json({ error: readError?.message ?? "Account not found." }, { status: 404 });
  if (account.executor_id !== parsed.data.executorId || account.verification_status !== "running") {
    return NextResponse.json({ error: "Verification is not owned by this worker." }, { status: 409 });
  }

  const actualHandle = parsed.data.actualHandle ?? null;
  const egressIp = parsed.data.egressIp ?? null;
  const expectedHandle = String(account.expected_x_handle ?? "");
  const handleMatches = Boolean(actualHandle && expectedHandle && actualHandle.toLowerCase() === expectedHandle.toLowerCase());
  const vpnMatches = account.network_mode !== "vpn_direct"
    || Boolean(egressIp && String(account.expected_egress_ip ?? "") === egressIp);
  let errorMessage = parsed.data.errorMessage ?? null;
  if (!errorMessage && !handleMatches) errorMessage = `实际登录账号 @${actualHandle ?? "未识别"} 与期望 @${expectedHandle || "未配置"} 不一致。`;
  if (!errorMessage && !vpnMatches) errorMessage = `实际出口 ${egressIp ?? "未识别"} 与锁定 VPN 出口 ${String(account.expected_egress_ip ?? "未配置")} 不一致。`;
  if (!errorMessage && !egressIp) errorMessage = "未能确认该账号浏览器的出口 IP。";

  if (!errorMessage && account.network_mode === "fixed_proxy") {
    const proxyRelation = account.x_reply_account_proxies;
    const configuredProxy = Array.isArray(proxyRelation) ? proxyRelation[0] : proxyRelation;
    const boundEgressIp = configuredProxy?.egress_ip ? String(configuredProxy.egress_ip) : null;
    if (egressIp && !isBoundProxyEgress(boundEgressIp, egressIp)) {
      errorMessage = `固定代理出口由 ${boundEgressIp} 变为 ${egressIp}，已阻止使用。`;
      await supabase.from("x_reply_account_proxies").update({
        status: "error",
        last_tested_at: new Date().toISOString(),
        last_error: errorMessage,
      }).eq("account_id", account.id);
    }
  }

  if (!errorMessage && account.network_mode === "fixed_proxy") {
    const { error: proxyError } = await supabase.from("x_reply_account_proxies").update({
      status: "healthy",
      egress_ip: egressIp,
      last_tested_at: new Date().toISOString(),
      last_error: null,
    }).eq("account_id", account.id);
    if (proxyError) errorMessage = proxyError.code === "23505"
      ? "该出口 IP 已绑定其他 X 账号，映射验证失败。"
      : proxyError.message;
  }

  const completedAt = new Date().toISOString();
  const passed = !errorMessage && handleMatches && vpnMatches && Boolean(egressIp);
  const { error: updateError } = await supabase.from("x_reply_accounts").update({
    verification_status: passed ? "passed" : "failed",
    verification_completed_at: completedAt,
    verified_x_handle: actualHandle,
    verified_egress_ip: egressIp,
    verification_error: errorMessage,
  }).eq("id", account.id).eq("verification_status", "running");
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await supabase.from("x_reply_workers").update({
    current_egress_ip: egressIp,
    network_probe_status: passed ? "healthy" : "mismatch",
    last_error: errorMessage,
    last_seen_at: completedAt,
  }).eq("executor_id", parsed.data.executorId);
  return NextResponse.json({ ok: true, passed });
}
