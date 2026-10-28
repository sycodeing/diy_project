import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isAuthorizedXReplyWorker } from "@/lib/x-reply-worker-auth";
import { getXReplyWorkerSecret } from "@/lib/env";
import { decryptProxyUrl } from "@/lib/x-proxy-crypto";

export const runtime = "nodejs";

const requestSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  bitbrowserAvailable: z.boolean(),
  bitbrowserVersion: z.string().trim().max(40).nullable().optional(),
  windows: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    name: z.string().trim().max(120),
    seq: z.number().int().nullable(),
    status: z.number().int().nullable(),
  })).max(100),
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
  const available = parsed.data.bitbrowserAvailable && parsed.data.windows.length > 0;
  const availableWindowIds = new Set(parsed.data.windows.map((window) => window.id));
  const { error: heartbeatError } = await supabase.from("x_reply_workers").upsert({
    worker_id: parsed.data.workerId,
    status: available ? "online" : "paused",
    xuse_available: false,
    configured_accounts: [],
    bitbrowser_available: parsed.data.bitbrowserAvailable,
    bitbrowser_version: parsed.data.bitbrowserVersion ?? null,
    bitbrowser_windows: parsed.data.windows,
    current_job_id: null,
    worker_version: parsed.data.version ?? null,
    last_error: parsed.data.errorMessage ?? (available ? null : "比特浏览器本地 API 不可用或没有窗口。"),
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
    .select("id,account_key,bitbrowser_window_id,require_daily_first_confirmation,x_reply_account_proxies!inner(encrypted_url)")
    .eq("active", true)
    .not("bitbrowser_window_id", "is", null);
  if (accountsError) return NextResponse.json({ error: accountsError.message }, { status: 500 });
  if (!accounts?.length) return new Response(null, { status: 204 });
  const workerSecret = getXReplyWorkerSecret();
  if (!workerSecret) return NextResponse.json({ error: "Worker encryption key is unavailable." }, { status: 503 });
  const accountRoutes = new Map<string, { accountKey: string; proxyUrl: string; windowId: string; requiresConfirmation: boolean }>();
  for (const account of accounts) {
    if (!account.bitbrowser_window_id || !availableWindowIds.has(account.bitbrowser_window_id)) continue;
    const relation = Array.isArray(account.x_reply_account_proxies)
      ? account.x_reply_account_proxies[0]
      : account.x_reply_account_proxies;
    if (!relation?.encrypted_url) continue;
    try {
      accountRoutes.set(account.id, {
        accountKey: account.account_key,
        proxyUrl: decryptProxyUrl(relation.encrypted_url, workerSecret),
        windowId: account.bitbrowser_window_id,
        requiresConfirmation: account.require_daily_first_confirmation,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "代理密文无法解密。";
      await supabase.from("x_reply_account_proxies").update({ status: "error", last_error: message.slice(0, 1000) }).eq("account_id", account.id);
    }
  }
  if (!accountRoutes.size) return new Response(null, { status: 204 });

  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const dateValues = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  const shanghaiDate = `${dateValues.year}-${dateValues.month}-${dateValues.day}`;
  const { data: gates, error: gatesError } = await supabase.from("x_reply_daily_gates")
    .select("account_id,status")
    .eq("gate_date", shanghaiDate)
    .in("account_id", [...accountRoutes.keys()]);
  if (gatesError) return NextResponse.json({ error: gatesError.message }, { status: 500 });
  const gateStatus = new Map((gates ?? []).map((gate) => [gate.account_id, gate.status]));
  const eligibleAccountIds = [...accountRoutes.entries()].filter(([accountId, route]) => {
    if (!route.requiresConfirmation) return true;
    const status = gateStatus.get(accountId);
    return status == null || status === "pending" || status === "authorized";
  }).map(([accountId]) => accountId);
  if (!eligibleAccountIds.length) return new Response(null, { status: 204 });

  const { data: queued, error: readError } = await supabase
    .from("x_reply_jobs")
    .select("id,account_id,action_type,target_post_url,reply_text,scheduled_for,created_at")
    .eq("status", "queued")
    .eq("attempt_count", 0)
    .lte("scheduled_for", now)
    .in("account_id", eligibleAccountIds)
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
  const route = accountRoutes.get(claimed.account_id);
  if (!route) return NextResponse.json({ error: "Claimed account route is unavailable." }, { status: 500 });
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
        status: "uncertain", completed_at: now, error_code: "daily_gate_failed",
        error_message: "每日首条监督状态写入失败；任务没有下发，请人工核对。",
      }).eq("id", claimed.id).eq("status", "claimed");
      return NextResponse.json({ error: gateError.message }, { status: 500 });
    }
  }
  return NextResponse.json({ job: {
    id: claimed.id,
    accountKey: route.accountKey,
    proxyUrl: route.proxyUrl,
    bitbrowserWindowId: route.windowId,
    supervisedFirst,
    actionType: claimed.action_type,
    targetPostUrl: claimed.target_post_url,
    postText: claimed.reply_text,
  } });
}
