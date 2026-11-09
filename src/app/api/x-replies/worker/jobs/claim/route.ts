import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getXReplyWorkerSecret } from "@/lib/env";
import { getMarketingReplyPreviewUrl } from "@/lib/marketing";
import { decryptProxyUrl } from "@/lib/x-proxy-crypto";
import { isAuthorizedXReplyWorker } from "@/lib/x-reply-worker-auth";
import { isBoundProxyEgress, isXAccountClaimEligible, isXDailyGateClaimAllowed, isXJobClaimEligible } from "@/lib/x-reply-safety";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const ipSchema = z.string().trim().max(64).refine((value) => isIP(value) !== 0);
const requestSchema = z.object({
  executorId: z.string().trim().min(1).max(120),
  executionMode: z.enum(["observe", "send"]),
  workerVersion: z.string().trim().min(1).max(80),
  deviceLabel: z.string().trim().max(120).nullable().optional(),
  xUseAvailable: z.boolean(),
  configuredAccounts: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(100),
  currentEgressIp: ipSchema.nullable(),
  networkProbeStatus: z.enum(["unknown", "healthy", "mismatch", "error"]),
  lastError: z.string().trim().max(1000).nullable().optional(),
  inspectionBusy: z.boolean().optional(),
  networkVerification: z.object({
    jobId: z.string().uuid(),
    accountKey: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    egressIp: ipSchema,
  }).optional(),
});

type AccountRoute = {
  id: string;
  accountKey: string;
  networkMode: "vpn_direct" | "fixed_proxy";
  expectedEgressIp: string | null;
  requiresConfirmation: boolean;
  encryptedProxyUrl: string | null;
  proxyStatus: "pending" | "healthy" | "error" | null;
  proxyEgressIp: string | null;
};

export async function POST(request: Request) {
  if (!isAuthorizedXReplyWorker(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid worker heartbeat." }, { status: 400 });
  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const heartbeat = parsed.data;
  const now = new Date().toISOString();
  const available = heartbeat.xUseAvailable && heartbeat.configuredAccounts.length > 0;
  const { data: workerState, error: heartbeatError } = await supabase.from("x_reply_workers").upsert({
    worker_id: heartbeat.executorId,
    executor_id: heartbeat.executorId,
    execution_mode: heartbeat.executionMode,
    device_label: heartbeat.deviceLabel ?? null,
    status: heartbeat.executionMode === "observe" ? "paused" : available ? "online" : "error",
    xuse_available: heartbeat.xUseAvailable,
    configured_accounts: heartbeat.configuredAccounts,
    current_egress_ip: heartbeat.currentEgressIp,
    network_probe_status: heartbeat.networkProbeStatus,
    bitbrowser_available: false,
    bitbrowser_version: null,
    bitbrowser_windows: [],
    current_job_id: null,
    worker_version: heartbeat.workerVersion,
    last_error: heartbeat.lastError ?? (available ? null : "x-use 不可用或没有本地账号。"),
    last_seen_at: now,
  }, { onConflict: "worker_id" }).select("cooldown_until").maybeSingle();
  if (heartbeatError) return NextResponse.json({ error: heartbeatError.message }, { status: 500 });

  const staleVerificationBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  await supabase.from("x_reply_accounts").update({
    verification_status: "pending",
    verification_started_at: null,
    verification_error: "上次验证超时，已自动重新排队。",
  }).eq("executor_id", heartbeat.executorId).eq("verification_status", "running").lt("verification_started_at", staleVerificationBefore);

  // x-use allows only one MCP server for a given X_USE_HOME. Keep the
  // heartbeat fresh while an account profile is visibly open, but do not
  // claim another verification or an approved write against that home.
  if (heartbeat.inspectionBusy) return new Response(null, { status: 204 });

  const { data: verificationAccount, error: verificationReadError } = await supabase.from("x_reply_accounts")
    .select("id,account_key,expected_x_handle,executor_id,network_mode,expected_egress_ip,x_reply_account_proxies(encrypted_url)")
    .eq("active", true)
    .eq("executor_id", heartbeat.executorId)
    .eq("verification_status", "pending")
    .order("verification_requested_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (verificationReadError) return NextResponse.json({ error: verificationReadError.message }, { status: 500 });
  if (verificationAccount) {
    const proxyRelation = verificationAccount.x_reply_account_proxies;
    const proxy = Array.isArray(proxyRelation) ? proxyRelation[0] : proxyRelation;
    let verificationProxyUrl: string | null = null;
    if (verificationAccount.network_mode === "fixed_proxy") {
      const workerSecret = getXReplyWorkerSecret();
      if (!workerSecret || !proxy?.encrypted_url) {
        await supabase.from("x_reply_accounts").update({
          verification_status: "failed",
          verification_completed_at: now,
          verification_error: "固定代理配置不可用，无法执行映射验证。",
        }).eq("id", verificationAccount.id).eq("verification_status", "pending");
        return new Response(null, { status: 204 });
      }
      try {
        verificationProxyUrl = decryptProxyUrl(proxy.encrypted_url, workerSecret);
      } catch {
        await supabase.from("x_reply_accounts").update({
          verification_status: "failed",
          verification_completed_at: now,
          verification_error: "固定代理密文无法解密。",
        }).eq("id", verificationAccount.id).eq("verification_status", "pending");
        return new Response(null, { status: 204 });
      }
    }
    const { data: claimedVerification, error: verificationClaimError } = await supabase.from("x_reply_accounts").update({
      verification_status: "running",
      verification_started_at: now,
      verification_error: null,
    }).eq("id", verificationAccount.id).eq("verification_status", "pending").select("id").maybeSingle();
    if (verificationClaimError) return NextResponse.json({ error: verificationClaimError.message }, { status: 500 });
    if (claimedVerification) return NextResponse.json({ verification: {
      id: verificationAccount.id,
      accountKey: verificationAccount.account_key,
      expectedXHandle: verificationAccount.expected_x_handle,
      networkMode: verificationAccount.network_mode,
      expectedEgressIp: verificationAccount.expected_egress_ip ? String(verificationAccount.expected_egress_ip) : null,
      proxyUrl: verificationProxyUrl,
    } });
  }

  // Observe may execute the explicit read-only mapping verification above, but never claims writes.
  if (heartbeat.executionMode !== "send") return new Response(null, { status: 204 });
  if (workerState?.cooldown_until && Date.parse(workerState.cooldown_until) > Date.now()) return new Response(null, { status: 204 });

  // A claimed write can already have reached X before the worker disappeared.
  // Only an active send-mode executor may reconcile stale claims.
  const staleBefore = new Date(Date.now() - 30 * 60_000).toISOString();
  const { error: staleError } = await supabase.from("x_reply_jobs").update({
    status: "uncertain",
    completed_at: now,
    error_code: "worker_disappeared",
    error_message: "本机执行器领取任务后超过 30 分钟未回报。请先到 X 核对，禁止自动重试。",
  }).eq("status", "claimed")
    .eq("worker_id", heartbeat.executorId)
    .lt("claimed_at", staleBefore);
  if (staleError) return NextResponse.json({ error: staleError.message }, { status: 500 });
  if (!available) return new Response(null, { status: 204 });

  const { data: accountRows, error: accountsError } = await supabase
    .from("x_reply_accounts")
    .select("id,account_key,executor_id,network_mode,expected_egress_ip,verification_status,require_daily_first_confirmation,x_reply_account_proxies(encrypted_url,status,egress_ip)")
    .eq("active", true)
    .eq("executor_id", heartbeat.executorId);
  if (accountsError) return NextResponse.json({ error: accountsError.message }, { status: 500 });

  const accountRoutes = new Map<string, AccountRoute>();
  for (const account of accountRows ?? []) {
    if (account.network_mode !== "vpn_direct" && account.network_mode !== "fixed_proxy") continue;
    if (["pending", "running"].includes(account.verification_status)) continue;
    const proxy = Array.isArray(account.x_reply_account_proxies)
      ? account.x_reply_account_proxies[0]
      : account.x_reply_account_proxies;
    if (!isXAccountClaimEligible({
      executionMode: heartbeat.executionMode,
      executorId: heartbeat.executorId,
      xuseAvailable: heartbeat.xUseAvailable,
      configuredAccounts: heartbeat.configuredAccounts,
      currentEgressIp: heartbeat.currentEgressIp,
      networkProbeStatus: heartbeat.networkProbeStatus,
      account: {
        executorId: account.executor_id,
        accountKey: account.account_key,
        networkMode: account.network_mode,
        expectedEgressIp: account.expected_egress_ip ? String(account.expected_egress_ip) : null,
        verificationStatus: account.verification_status,
        hasProxy: Boolean(proxy?.encrypted_url),
        proxyStatus: proxy?.status ?? null,
      },
    })) continue;
    accountRoutes.set(account.id, {
      id: account.id,
      accountKey: account.account_key,
      networkMode: account.network_mode,
      expectedEgressIp: account.expected_egress_ip ? String(account.expected_egress_ip) : null,
      requiresConfirmation: account.require_daily_first_confirmation,
      encryptedProxyUrl: proxy?.encrypted_url ?? null,
      proxyStatus: proxy?.status ?? null,
      proxyEgressIp: proxy?.egress_ip ? String(proxy.egress_ip) : null,
    });
  }
  if (!accountRoutes.size) return new Response(null, { status: 204 });

  const shanghaiDate = getShanghaiDate();
  const { data: gates, error: gatesError } = await supabase.from("x_reply_daily_gates")
    .select("account_id,status")
    .eq("gate_date", shanghaiDate)
    .in("account_id", [...accountRoutes.keys()]);
  if (gatesError) return NextResponse.json({ error: gatesError.message }, { status: 500 });
  const gateStatus = new Map((gates ?? []).map((gate) => [gate.account_id, gate.status]));
  const eligibleAccountIds = [...accountRoutes.entries()]
    .filter(([accountId, route]) => isXDailyGateClaimAllowed(route.requiresConfirmation, gateStatus.get(accountId)))
    .map(([accountId]) => accountId);
  if (!eligibleAccountIds.length) return new Response(null, { status: 204 });

  let queuedQuery = supabase
    .from("x_reply_jobs")
    .select("id,account_id,action_type,target_post_url,reply_text,scheduled_for,created_at,status,preparation_status,attempt_count,approved_at,x_leads(marketing_links!x_leads_marketing_link_id_fkey(source_hash,expires_at))")
    .eq("status", "queued")
    .eq("preparation_status", "ready")
    .eq("attempt_count", 0)
    .not("approved_at", "is", null)
    .lte("scheduled_for", now)
    .in("account_id", eligibleAccountIds);
  if (heartbeat.networkVerification) queuedQuery = queuedQuery.eq("id", heartbeat.networkVerification.jobId);
  const { data: queued, error: readError } = await queuedQuery
    .order("scheduled_for", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!queued) return new Response(null, { status: 204 });
  if (!isXJobClaimEligible({
    status: queued.status,
    preparationStatus: queued.preparation_status,
    attemptCount: queued.attempt_count,
    approvedAt: queued.approved_at,
    scheduledFor: queued.scheduled_for,
    nowMillis: Date.parse(now),
  })) return new Response(null, { status: 204 });

  const leadRelation = Array.isArray(queued.x_leads) ? queued.x_leads[0] : queued.x_leads;
  const linkRelation = leadRelation?.marketing_links;
  const marketingLink = Array.isArray(linkRelation) ? linkRelation[0] : linkRelation;
  const preview = marketingLink
    ? await getMarketingReplyPreviewUrl(marketingLink.source_hash, marketingLink.expires_at)
    : null;
  if (!preview) {
    await supabase.from("x_reply_jobs").update({
      preparation_status: "failed",
      preparation_error: "发送预览图暂时不可用；任务未下发，请重新生成素材。",
    }).eq("id", queued.id).eq("status", "queued").eq("preparation_status", "ready");
    return new Response(null, { status: 204 });
  }

  const route = accountRoutes.get(queued.account_id);
  if (!route) return new Response(null, { status: 204 });
  let proxyUrl: string | null = null;
  if (route.networkMode === "fixed_proxy") {
    if (!route.encryptedProxyUrl) return new Response(null, { status: 204 });
    const workerSecret = getXReplyWorkerSecret();
    if (!workerSecret) return NextResponse.json({ error: "Worker encryption key is unavailable." }, { status: 503 });
    try {
      proxyUrl = decryptProxyUrl(route.encryptedProxyUrl, workerSecret);
    } catch {
      await supabase.from("x_reply_account_proxies").update({ status: "error", last_error: "代理密文无法解密。" }).eq("account_id", route.id);
      return new Response(null, { status: 204 });
    }
    const verification = heartbeat.networkVerification;
    if (!verification) {
      return NextResponse.json({ probe: {
        jobId: queued.id,
        accountKey: route.accountKey,
        networkMode: route.networkMode,
        proxyUrl,
      } });
    }
    if (verification.jobId !== queued.id || verification.accountKey !== route.accountKey) return new Response(null, { status: 204 });
    if (!isBoundProxyEgress(route.proxyEgressIp, verification.egressIp)) {
      await supabase.from("x_reply_account_proxies").update({
        status: "error",
        last_tested_at: now,
        last_error: `固定代理出口由 ${route.proxyEgressIp} 变为 ${verification.egressIp}，已阻止发送。`,
      }).eq("account_id", route.id);
      return new Response(null, { status: 204 });
    }
    const { data: verifiedProxy, error: proxyError } = await supabase.from("x_reply_account_proxies").update({
      status: "healthy",
      egress_ip: verification.egressIp,
      last_tested_at: now,
      last_error: null,
    }).eq("account_id", route.id).select("account_id").maybeSingle();
    if (proxyError?.code === "23505") {
      await supabase.from("x_reply_account_proxies").update({
        status: "error",
        egress_ip: null,
        last_tested_at: now,
        last_error: "该出口 IP 已绑定其他 X 账号，已阻止发送。",
      }).eq("account_id", route.id);
      return new Response(null, { status: 204 });
    }
    if (proxyError || !verifiedProxy) return new Response(null, { status: 204 });
  }

  const { data: claimed, error: claimError } = await supabase.from("x_reply_jobs").update({
    status: "claimed",
    worker_id: heartbeat.executorId,
    claimed_at: now,
    attempt_count: 1,
    error_code: null,
    error_message: null,
  }).eq("id", queued.id).eq("status", "queued").eq("attempt_count", 0)
    .not("approved_at", "is", null)
    .lte("scheduled_for", now)
    .select("id,account_id,action_type,target_post_url,reply_text,scheduled_for,created_at")
    .maybeSingle();
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!claimed) return new Response(null, { status: 204 });

  await supabase.from("x_reply_workers").update({ status: "busy", current_job_id: claimed.id, last_seen_at: now })
    .eq("executor_id", heartbeat.executorId);
  const supervisedFirst = route.requiresConfirmation && gateStatus.get(claimed.account_id) !== "authorized";
  if (supervisedFirst) {
    const { error: gateError } = await supabase.from("x_reply_daily_gates").upsert({
      account_id: claimed.account_id,
      gate_date: shanghaiDate,
      status: "awaiting_confirmation",
      first_job_id: claimed.id,
      first_sent_at: null,
      authorized_at: null,
      authorized_by: null,
    }, { onConflict: "account_id,gate_date" });
    if (gateError) {
      await supabase.from("x_reply_jobs").update({
        status: "uncertain",
        completed_at: now,
        error_code: "daily_gate_failed",
        error_message: "每日首条监督状态写入失败；任务没有下发，请人工核对。",
      }).eq("id", claimed.id).eq("status", "claimed");
      return NextResponse.json({ error: gateError.message }, { status: 500 });
    }
  }
  return NextResponse.json({ job: {
    id: claimed.id,
    accountKey: route.accountKey,
    networkMode: route.networkMode,
    proxyUrl,
    supervisedFirst,
    actionType: claimed.action_type,
    targetPostUrl: claimed.target_post_url,
    postText: claimed.reply_text,
    previewImageUrl: preview.url,
  } });
}

function getShanghaiDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
