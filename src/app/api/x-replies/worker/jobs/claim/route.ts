import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getXReplyWorkerSecret } from "@/lib/env";
import { getMarketingReplyPreviewUrl } from "@/lib/marketing";
import { decryptProxyUrl } from "@/lib/x-proxy-crypto";
import { isAuthorizedXReplyWorker } from "@/lib/x-reply-worker-auth";
import { isBoundProxyEgress, isXAccountClaimEligible, isXAccountCooldownActive, isXDailyGateClaimAllowed, isXJobClaimEligible } from "@/lib/x-reply-safety";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isValidXFirstContactText } from "@/lib/x-lead-copy";

export const runtime = "nodejs";

const ipSchema = z.string().trim().max(64).refine((value) => isIP(value) !== 0);
const requestSchema = z.object({
  executorId: z.string().trim().min(1).max(120),
  executionMode: z.enum(["observe", "send"]),
  workerVersion: z.string().trim().min(1).max(80),
  capabilities: z.array(z.string().max(80)).max(20).default([]),
  deviceLabel: z.string().trim().max(120).nullable().optional(),
  xUseAvailable: z.boolean(),
  configuredAccounts: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(100),
  currentEgressIp: ipSchema.nullable(),
  networkProbeStatus: z.enum(["unknown", "healthy", "mismatch", "error"]),
  lastError: z.string().trim().max(1000).nullable().optional(),
  writesPaused: z.boolean().optional(),
  inspectionBusy: z.boolean().optional(),
  inspectionAccountKeys: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(100).optional(),
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
  const { error: heartbeatError } = await supabase.from("x_reply_workers").upsert({
    worker_id: heartbeat.executorId,
    executor_id: heartbeat.executorId,
    execution_mode: heartbeat.executionMode,
    device_label: heartbeat.deviceLabel ?? null,
    status: heartbeat.executionMode === "observe" || heartbeat.writesPaused ? "paused" : available ? "online" : "error",
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
  }, { onConflict: "worker_id" });
  if (heartbeatError) return NextResponse.json({ error: heartbeatError.message }, { status: 500 });

  const staleVerificationBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  await supabase.from("x_reply_accounts").update({
    verification_status: "pending",
    verification_started_at: null,
    verification_error: "上次验证超时，已自动重新排队。",
  }).eq("executor_id", heartbeat.executorId).eq("verification_status", "running").lt("verification_started_at", staleVerificationBefore);

  const staleInspectionBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  await supabase.from("x_reply_jobs").update({
    inspection_status: "failed",
    inspection_completed_at: now,
    inspection_error: "绑定路由浏览窗口超时或执行器已重启，请重新打开。",
  }).eq("inspection_status", "running").eq("inspection_executor_id", heartbeat.executorId)
    .lt("inspection_started_at", staleInspectionBefore);

  const staleManualOpenBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  await supabase.from("x_manual_posts").update({
    bound_open_status: "failed",
    bound_open_completed_at: now,
    bound_open_error: "Latte 绑定发送窗口超时或执行器已重启，请重新打开。",
  }).eq("bound_open_status", "running").eq("bound_open_executor_id", heartbeat.executorId)
    .lt("bound_open_started_at", staleManualOpenBefore);

  if (!heartbeat.inspectionBusy) {
    const { data: manualPost, error: manualReadError } = await supabase.from("x_manual_posts")
      .select("id,bound_open_target_url,x_reply_accounts!inner(account_key,expected_x_handle,active,executor_id,network_mode,expected_egress_ip,verification_status,x_reply_account_proxies(encrypted_url,status,egress_ip))")
      .eq("bound_open_status", "pending")
      .eq("x_reply_accounts.active", true)
      .eq("x_reply_accounts.executor_id", heartbeat.executorId)
      .order("bound_open_requested_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (manualReadError) return NextResponse.json({ error: manualReadError.message }, { status: 500 });
    if (manualPost) {
      const accountRelation = manualPost.x_reply_accounts;
      const account = Array.isArray(accountRelation) ? accountRelation[0] : accountRelation;
      const proxyRelation = account?.x_reply_account_proxies;
      const proxy = Array.isArray(proxyRelation) ? proxyRelation[0] : proxyRelation;
      let routeError: string | null = null;
      let inspectionProxyUrl: string | null = null;
      let expectedInspectionEgressIp: string | null = null;
      if (!heartbeat.xUseAvailable || !account || !heartbeat.configuredAccounts.includes(account.account_key)) {
        routeError = "绑定执行器缺少 Latte 的本地 x-use 登录数据。";
      } else if (account.account_key !== "Latte192837465") {
        routeError = "手动发送窗口只能使用 Latte192837465。";
      } else if (account.verification_status !== "passed") {
        routeError = "Latte 尚未通过账号与出口映射验证。";
      } else if (!manualPost.bound_open_target_url) {
        routeError = "没有可打开的 X 目标链接。";
      } else if (account.network_mode === "vpn_direct") {
        expectedInspectionEgressIp = account.expected_egress_ip ? String(account.expected_egress_ip) : null;
        if (!expectedInspectionEgressIp || heartbeat.networkProbeStatus !== "healthy"
          || heartbeat.currentEgressIp !== expectedInspectionEgressIp) {
          routeError = "当前 VPN 出口与 Latte 锁定的出口不一致。";
        }
      } else if (account.network_mode === "fixed_proxy") {
        expectedInspectionEgressIp = proxy?.egress_ip ? String(proxy.egress_ip) : null;
        if (!proxy?.encrypted_url || proxy.status !== "healthy" || !expectedInspectionEgressIp) {
          routeError = "Latte 的固定代理尚未确认健康出口。";
        } else {
          const workerSecret = getXReplyWorkerSecret();
          if (!workerSecret) {
            routeError = "Worker 加密密钥不可用。";
          } else {
            try {
              inspectionProxyUrl = decryptProxyUrl(proxy.encrypted_url, workerSecret);
            } catch {
              routeError = "固定代理密文无法解密。";
            }
          }
        }
      } else {
        routeError = "Latte 网络模式无效。";
      }
      if (routeError) {
        await supabase.from("x_manual_posts").update({
          bound_open_status: "failed",
          bound_open_completed_at: now,
          bound_open_error: routeError,
        }).eq("id", manualPost.id).eq("bound_open_status", "pending");
        return new Response(null, { status: 204 });
      }
      const { data: claimedManual, error: manualClaimError } = await supabase.from("x_manual_posts").update({
        bound_open_status: "running",
        bound_open_started_at: now,
        bound_open_completed_at: null,
        bound_open_error: null,
        bound_open_executor_id: heartbeat.executorId,
      }).eq("id", manualPost.id).eq("bound_open_status", "pending").select("id").maybeSingle();
      if (manualClaimError) return NextResponse.json({ error: manualClaimError.message }, { status: 500 });
      if (claimedManual && account) return NextResponse.json({ inspection: {
        id: manualPost.id,
        kind: "manual",
        accountKey: account.account_key,
        expectedXHandle: account.expected_x_handle,
        networkMode: account.network_mode,
        expectedEgressIp: expectedInspectionEgressIp,
        proxyUrl: inspectionProxyUrl,
        targetUrl: manualPost.bound_open_target_url,
      } });
    }
  }

  if (!heartbeat.inspectionBusy) {
    const { data: inspectionJob, error: inspectionReadError } = await supabase.from("x_reply_jobs")
      .select("id,inspection_target_url,x_reply_accounts!inner(account_key,expected_x_handle,active,executor_id,network_mode,expected_egress_ip,verification_status,x_reply_account_proxies(encrypted_url,status,egress_ip))")
      .eq("inspection_status", "pending")
      .eq("x_reply_accounts.active", true)
      .eq("x_reply_accounts.executor_id", heartbeat.executorId)
      .order("inspection_requested_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (inspectionReadError) return NextResponse.json({ error: inspectionReadError.message }, { status: 500 });
    if (inspectionJob) {
      const accountRelation = inspectionJob.x_reply_accounts;
      const account = Array.isArray(accountRelation) ? accountRelation[0] : accountRelation;
      const proxyRelation = account?.x_reply_account_proxies;
      const proxy = Array.isArray(proxyRelation) ? proxyRelation[0] : proxyRelation;
      let routeError: string | null = null;
      let inspectionProxyUrl: string | null = null;
      let expectedInspectionEgressIp: string | null = null;
      if (!heartbeat.xUseAvailable || !account || !heartbeat.configuredAccounts.includes(account.account_key)) {
        routeError = "绑定执行器缺少该账号的本地 x-use 登录数据。";
      } else if (account.verification_status !== "passed") {
        routeError = "该账号尚未通过账号与出口映射验证。";
      } else if (!inspectionJob.inspection_target_url) {
        routeError = "没有可打开的 X 原帖链接。";
      } else if (account.network_mode === "vpn_direct") {
        expectedInspectionEgressIp = account.expected_egress_ip ? String(account.expected_egress_ip) : null;
        if (!expectedInspectionEgressIp || heartbeat.networkProbeStatus !== "healthy"
          || heartbeat.currentEgressIp !== expectedInspectionEgressIp) {
          routeError = "当前 VPN 出口与该账号锁定的出口不一致。";
        }
      } else if (account.network_mode === "fixed_proxy") {
        expectedInspectionEgressIp = proxy?.egress_ip ? String(proxy.egress_ip) : null;
        if (!proxy?.encrypted_url || proxy.status !== "healthy" || !expectedInspectionEgressIp) {
          routeError = "该账号的固定代理尚未确认健康出口。";
        } else {
          const workerSecret = getXReplyWorkerSecret();
          if (!workerSecret) {
            routeError = "Worker 加密密钥不可用。";
          } else {
            try {
              inspectionProxyUrl = decryptProxyUrl(proxy.encrypted_url, workerSecret);
            } catch {
              routeError = "固定代理密文无法解密。";
            }
          }
        }
      } else {
        routeError = "账号网络模式无效。";
      }
      if (routeError) {
        await supabase.from("x_reply_jobs").update({
          inspection_status: "failed",
          inspection_completed_at: now,
          inspection_error: routeError,
        }).eq("id", inspectionJob.id).eq("inspection_status", "pending");
        return new Response(null, { status: 204 });
      }
      const { data: claimedInspection, error: inspectionClaimError } = await supabase.from("x_reply_jobs").update({
        inspection_status: "running",
        inspection_started_at: now,
        inspection_completed_at: null,
        inspection_error: null,
        inspection_executor_id: heartbeat.executorId,
      }).eq("id", inspectionJob.id).eq("inspection_status", "pending").select("id").maybeSingle();
      if (inspectionClaimError) return NextResponse.json({ error: inspectionClaimError.message }, { status: 500 });
      if (claimedInspection && account) return NextResponse.json({ inspection: {
        id: inspectionJob.id,
        accountKey: account.account_key,
        expectedXHandle: account.expected_x_handle,
        networkMode: account.network_mode,
        expectedEgressIp: expectedInspectionEgressIp,
        proxyUrl: inspectionProxyUrl,
        targetUrl: inspectionJob.inspection_target_url,
      } });
    }
  }

  const { data: verificationAccount, error: verificationReadError } = await supabase.from("x_reply_accounts")
    .select("id,account_key,expected_x_handle,executor_id,network_mode,expected_egress_ip,x_reply_account_proxies(encrypted_url)")
    .eq("active", true)
    .eq("executor_id", heartbeat.executorId)
    .eq("verification_status", "pending")
    .order("verification_requested_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (verificationReadError) return NextResponse.json({ error: verificationReadError.message }, { status: 500 });
  // One visible inspection may stay open, but it only blocks another inspection.
  // Writes for other eligible accounts can continue in parallel.
  if (verificationAccount && !heartbeat.inspectionBusy) {
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
  // A worker paused by a critical account-safety signal keeps heartbeating so
  // admins can still launch bound-route, read-only inspections.
  if (heartbeat.executionMode !== "send" || heartbeat.writesPaused) return new Response(null, { status: 204 });

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
    .select("id,account_key,executor_id,network_mode,expected_egress_ip,verification_status,require_daily_first_confirmation,cooldown_until,x_reply_account_proxies(encrypted_url,status,egress_ip)")
    .eq("active", true)
    .eq("executor_id", heartbeat.executorId);
  if (accountsError) return NextResponse.json({ error: accountsError.message }, { status: 500 });

  const accountRoutes = new Map<string, AccountRoute>();
  const inspectionAccountKeys = new Set(heartbeat.inspectionAccountKeys ?? []);
  for (const account of accountRows ?? []) {
    if (account.network_mode !== "vpn_direct" && account.network_mode !== "fixed_proxy") continue;
    if (["pending", "running"].includes(account.verification_status)) continue;
    if (inspectionAccountKeys.has(account.account_key)) continue;
    if (isXAccountCooldownActive(account.cooldown_until, Date.parse(now))) continue;
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
    .select("account_id,status,first_job_id")
    .eq("gate_date", shanghaiDate)
    .in("account_id", [...accountRoutes.keys()]);
  if (gatesError) return NextResponse.json({ error: gatesError.message }, { status: 500 });
  const gateStatus = new Map((gates ?? []).map((gate) => [gate.account_id, gate.status]));
  const gateFirstJob = new Map((gates ?? []).map((gate) => [gate.account_id, gate.first_job_id]));
  const eligibleAccountIds = [...accountRoutes.entries()]
    .filter(([accountId, route]) => isXDailyGateClaimAllowed(route.requiresConfirmation, gateStatus.get(accountId)))
    .map(([accountId]) => accountId);
  const jobSelect = "id,account_id,action_type,target_post_url,reply_text,content_mode,copy_variant,scheduled_for,created_at,status,preparation_status,attempt_count,approved_at,action_id,error_code,x_leads(marketing_links!x_leads_marketing_link_id_fkey(source_hash,expires_at))";
  let retryQuery = supabase
    .from("x_reply_jobs")
    .select(jobSelect)
    .eq("status", "queued")
    .eq("preparation_status", "ready")
    .eq("attempt_count", 0)
    .eq("error_code", "manual_retry_not_sent")
    .not("action_id", "is", null)
    .not("approved_at", "is", null)
    .lte("scheduled_for", now)
    .in("account_id", [...accountRoutes.keys()]);
  if (heartbeat.networkVerification) retryQuery = retryQuery.eq("id", heartbeat.networkVerification.jobId);
  if (!heartbeat.capabilities.includes("first_contact_text_v1")) retryQuery = retryQuery.eq("content_mode", "legacy_preview");
  const { data: retryCandidates, error: retryReadError } = await retryQuery
    .order("scheduled_for", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(100);
  if (retryReadError) return NextResponse.json({ error: retryReadError.message }, { status: 500 });
  let queued = retryCandidates?.find((job) => {
    const route = accountRoutes.get(job.account_id);
    if (!route) return false;
    return isXDailyGateClaimAllowed(route.requiresConfirmation, gateStatus.get(job.account_id))
      || (gateStatus.get(job.account_id) === "paused" && gateFirstJob.get(job.account_id) === job.id);
  }) ?? null;
  if (!queued && eligibleAccountIds.length) {
    let queuedQuery = supabase.from("x_reply_jobs").select(jobSelect)
      .eq("status", "queued").eq("preparation_status", "ready").eq("attempt_count", 0)
      .or("error_code.is.null,error_code.neq.manual_retry_not_sent")
      .not("approved_at", "is", null).lte("scheduled_for", now)
      .in("account_id", eligibleAccountIds);
    if (heartbeat.networkVerification) queuedQuery = queuedQuery.eq("id", heartbeat.networkVerification.jobId);
    if (!heartbeat.capabilities.includes("first_contact_text_v1")) queuedQuery = queuedQuery.eq("content_mode", "legacy_preview");
    const { data, error } = await queuedQuery
      .order("scheduled_for", { ascending: true }).order("created_at", { ascending: true })
      .limit(1).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    queued = data;
  }
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
  const textOnly = queued.content_mode === "first_contact_text";
  if (textOnly && (queued.action_type !== "reply" || !queued.target_post_url || !isValidXFirstContactText(queued.reply_text))) {
    await supabase.from("x_reply_jobs").update({ preparation_status: "failed", preparation_error: "首条接触必须是无链接的有效回复文案，请人工检查。" })
      .eq("id", queued.id).eq("status", "queued");
    return new Response(null, { status: 204 });
  }
  const preview = !textOnly && marketingLink
    ? await getMarketingReplyPreviewUrl(marketingLink.source_hash, marketingLink.expires_at)
    : null;
  if (!textOnly && !preview) {
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

  let claimQuery = supabase.from("x_reply_jobs").update({
    status: "claimed",
    worker_id: heartbeat.executorId,
    claimed_at: now,
    attempt_count: 1,
    error_code: queued.error_code === "manual_retry_not_sent" ? "manual_retry_not_sent" : null,
    error_message: null,
  }).eq("id", queued.id).eq("status", "queued").eq("attempt_count", 0)
    .not("approved_at", "is", null)
    .eq("content_mode", queued.content_mode)
    .eq("reply_text", queued.reply_text)
    .eq("preparation_status", "ready")
    .lte("scheduled_for", now);
  if (queued.error_code === "manual_retry_not_sent") claimQuery = claimQuery.eq("error_code", "manual_retry_not_sent");
  const { data: claimed, error: claimError } = await claimQuery
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
    contentMode: queued.content_mode,
    copyVariant: queued.copy_variant,
    previewImageUrl: preview?.url ?? null,
    retryActionId: queued.error_code === "manual_retry_not_sent" ? queued.action_id : null,
  } });
}

function getShanghaiDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
