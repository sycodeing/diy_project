import { NextResponse } from "next/server";
import { z } from "zod";
import { getXReplyWorkerSecret } from "@/lib/env";
import { isAuthorizedXReplyWorker } from "@/lib/x-reply-worker-auth";
import { decryptProxyUrl } from "@/lib/x-proxy-crypto";
import { MANUAL_HELPER_ID, MANUAL_HELPER_CAPABILITY, manualRequestPurposeValid, MANUAL_SENDER_ID, MANUAL_SENDER_KEY, freshManualHelper, canonicalManualTargetUrl, manualHelperRegistrationBlocked, manualHelperLifecycleUpdate, canRenewIdleManualHeartbeat, manualRequestPreventsIdleRenewal } from "@/lib/x-account-manual";
import { manualDb, loadManualRoute } from "@/lib/x-account-manual-server";

export const runtime = "nodejs";
const input = z.object({ operation: z.enum(["register", "heartbeat", "claim", "complete", "stop"]),
  helperId: z.literal(MANUAL_HELPER_ID), capability: z.enum(["xuse-manual-read-v2", MANUAL_HELPER_CAPABILITY]), bootId: z.string().uuid(), requestId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(), status: z.enum(["opened_x_home", "opened_x_post", "blocked", "failed"]).optional(),
  sessionState: z.enum(["idle", "open", "blocked", "closed"]).optional(), idleNeverStarted: z.literal(true).optional(),
  routeRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(), expectedIp: z.string().max(64).optional(),
  ownerHandle: z.literal(MANUAL_SENDER_KEY).optional(), egressIp: z.string().max(64).optional(),
  message: z.string().max(300).optional() });

/** Dedicated helper only: never touches worker heartbeats, auto claim, approvals or cookies. */
export async function POST(request: Request) {
  if (!isAuthorizedXReplyWorker(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid manual helper request" }, { status: 400 });
  const body = parsed.data, db = manualDb(), now = new Date().toISOString();
  const opened = body.status === "opened_x_home" || body.status === "opened_x_post";
  if (body.operation === "register") {
    if (body.capability !== MANUAL_HELPER_CAPABILITY) return NextResponse.json({ error: "Manual helper update required" }, { status: 426 });
    const { data: existing, error: existingError } = await db.from("x_account_manual_helpers").select("*").eq("helper_id", body.helperId).maybeSingle();
    if (existingError) return NextResponse.json({ error: "Existing manual session unavailable" }, { status: 503 });
    if (manualHelperRegistrationBlocked(existing, body.bootId))
      return NextResponse.json({ error: "Existing manual session retained; close its original window before updating" }, { status: 409 });
    if (existing?.boot_id === body.bootId) return NextResponse.json({ bootedAt: existing.booted_at });
    const { error } = await db.from("x_account_manual_helpers").upsert({ helper_id: body.helperId, boot_id: body.bootId,
      booted_at: now, last_seen_at: now, status: "online", helper_version: MANUAL_HELPER_CAPABILITY,
      session_id: null, route_revision: null, expected_ip: null, observed_x_handle: null, session_state: "idle" });
    return error ? NextResponse.json({ error: "Manual registration failed" }, { status: 503 }) : NextResponse.json({ bootedAt: now });
  }
  const { data: helper, error: helperError } = await db.from("x_account_manual_helpers").select("*").eq("helper_id", body.helperId).eq("boot_id", body.bootId).maybeSingle();
  if (helperError) return NextResponse.json({ error: "Manual helper state unavailable" }, { status: 503 });
  if (!helper || helper.helper_version !== body.capability) return NextResponse.json({ error: "Manual helper boot mismatch" }, { status: 409 });
  const stale = !freshManualHelper({ ...helper, helper_version: MANUAL_HELPER_CAPABILITY });
  if (body.operation !== "stop" && stale) {
    if (!canRenewIdleManualHeartbeat(helper, body)) return NextResponse.json({ error: "Manual helper boot expired" }, { status: 409 });
    // Fence pending work before making the lease fresh. A competing old claim
    // either loses its pending CAS or appears in the subsequent audit read.
    const { error: fenceError } = await db.from("x_account_manual_open_requests").update({ status: "failed", completed_at: now,
      message: "助手心跳中断；旧请求已失效，未自动重放。请本人重新点击。" })
      .eq("helper_id", body.helperId).eq("boot_id", body.bootId).eq("status", "pending");
    if (fenceError) return NextResponse.json({ error: "Idle heartbeat recovery unavailable" }, { status: 503 });
    const { data: prior, error: priorError } = await db.from("x_account_manual_open_requests").select("status,claimed_at")
      .eq("helper_id", body.helperId).eq("boot_id", body.bootId);
    if (priorError) return NextResponse.json({ error: "Idle heartbeat recovery unavailable" }, { status: 503 });
    if ((prior ?? []).some(manualRequestPreventsIdleRenewal)) return NextResponse.json({ error: "Manual session history requires review" }, { status: 409 });
  }
  if (body.operation === "heartbeat" || body.operation === "stop") {
    if (body.operation === "heartbeat" && (!body.sessionState || body.sessionState === "open" && (!body.sessionId || !body.routeRevision || !body.expectedIp || body.ownerHandle !== MANUAL_SENDER_KEY)))
      return NextResponse.json({ error: "Current local session state required" }, { status: 400 });
    let update = db.from("x_account_manual_helpers").update(manualHelperLifecycleUpdate(helper, { ...body, operation: body.operation }, now))
      .eq("helper_id", body.helperId).eq("boot_id", body.bootId);
    if (body.operation === "heartbeat") {
      update = update.eq("status", "online").eq("session_state", helper.session_state);
      update = helper.session_id ? update.eq("session_id", helper.session_id) : update.is("session_id", null);
    }
    const { data: updated, error } = await update.select("helper_id").maybeSingle();
    return error ? NextResponse.json({ error: "Manual heartbeat failed" }, { status: 503 })
      : !updated ? NextResponse.json({ error: "Manual helper state changed" }, { status: 409 }) : NextResponse.json({ ok: true });
  }
  // Old helpers can keep their original user window alive, but cannot claim
  // v3 navigation work. Never replace their boot or session on deployment.
  if (body.capability !== MANUAL_HELPER_CAPABILITY && body.operation === "claim") return new Response(null, { status: 204 });
  if (body.operation === "complete") {
    if (!body.requestId || !body.status || opened && (!body.sessionId || !body.ownerHandle || !body.egressIp)) return NextResponse.json({ error: "Invalid completion" }, { status: 400 });
    const { data: current } = await db.from("x_account_manual_open_requests").select("purpose,task_id,expected_ip")
      .eq("id", body.requestId).eq("boot_id", body.bootId).eq("status", "opening").maybeSingle();
    if (!current || (opened && body.status !== (current.purpose === "manual_task_x_post" ? "opened_x_post" : "opened_x_home")) || !manualRequestPurposeValid(current.purpose, current.task_id)
      || opened && body.egressIp !== current.expected_ip)
      return NextResponse.json({ error: "Completion identity, purpose or IP mismatch" }, { status: 409 });
    const { data, error } = await db.from("x_account_manual_open_requests").update({ status: body.status,
      observed_x_handle: body.ownerHandle ?? null,
      session_id: body.sessionId ?? null, completed_at: now, message: body.message ?? null })
      .eq("id", body.requestId).eq("boot_id", body.bootId).eq("helper_id", body.helperId).eq("status", "opening").select("id").maybeSingle();
    if (!opened) await db.from("x_account_manual_helpers").update({ session_state: "blocked" })
      .eq("helper_id", body.helperId).eq("boot_id", body.bootId);
    return error || !data ? NextResponse.json({ error: "Completion no longer current" }, { status: 409 }) : NextResponse.json({ ok: true });
  }
  if (["blocked", "closed"].includes(helper.session_state)) return new Response(null, { status: 204 });
  // Boot and expiry are checked both when reading and during the CAS. No pre-restart request is replayed.
  const { data: pending, error: readError } = await db.from("x_account_manual_open_requests").select("id,task_id,purpose,account_id,boot_id,route_revision,expected_ip,expires_at,created_at")
    .eq("helper_id", body.helperId).eq("boot_id", body.bootId).eq("status", "pending")
    .in("purpose", ["manual_task_x_home", "account_x_home", "manual_task_x_post"])
    .gte("created_at", helper.booted_at).gt("expires_at", now).order("created_at").limit(1).maybeSingle();
  if (readError) return NextResponse.json({ error: "Manual request unavailable" }, { status: 503 });
  if (!pending) return new Response(null, { status: 204 });
  const { data: claimed, error: claimError } = await db.from("x_account_manual_open_requests")
    .update({ status: "opening", claimed_at: now }).eq("id", pending.id).eq("boot_id", body.bootId)
    .eq("status", "pending").gte("created_at", helper.booted_at).gt("expires_at", now).select("id").maybeSingle();
  if (claimError || !claimed) return new Response(null, { status: 204 });
  try {
    const route = await loadManualRoute();
    if (!manualRequestPurposeValid(pending.purpose, pending.task_id)) throw new Error("Invalid purpose.");
    let targetPostUrl: string | null = null;
    if (["manual_task_x_home", "manual_task_x_post"].includes(pending.purpose)) {
      const { data: task } = await db.from("x_account_manual_posts").select("id,status,account_id,target_post_url,snapshot")
        .eq("id", pending.task_id).eq("account_id", MANUAL_SENDER_ID).eq("status", "draft").maybeSingle();
      if (!task) throw new Error("Draft task changed.");
      if (pending.purpose === "manual_task_x_post") {
        targetPostUrl = canonicalManualTargetUrl(task.target_post_url);
        if (!targetPostUrl || helper.session_state !== "open" || !helper.session_id) throw new Error("Original live session required.");
        const { validateV2Snapshot } = await import("@/lib/x-reply-v2");
        if (await validateV2Snapshot(db, task.snapshot)) throw new Error("Task snapshot changed.");
      }
    }
    if (pending.account_id !== MANUAL_SENDER_ID || pending.route_revision !== route.revision || pending.expected_ip !== route.expectedIp)
      throw new Error("Sender or bound route changed; request blocked.");
    const secret = getXReplyWorkerSecret();
    if (!secret) throw new Error("Bound route unavailable.");
    return NextResponse.json({ request: { id: pending.id, taskId: pending.task_id, purpose: pending.purpose, bootId: body.bootId,
      expiresAt: pending.expires_at, createdAt: pending.created_at, accountId: MANUAL_SENDER_ID,
      accountKey: MANUAL_SENDER_KEY, routeRevision: route.revision, expectedIp: route.expectedIp,
      sessionId: helper.session_id, targetPostUrl, proxyUrl: pending.purpose === "manual_task_x_post" ? null : decryptProxyUrl(route.encryptedProxy, secret) } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await db.from("x_account_manual_open_requests").update({ status: "blocked", completed_at: now,
      message: "任务、固定发送账号或网络绑定已变化，未打开窗口。" }).eq("id", pending.id).eq("status", "opening");
    await db.from("x_account_manual_helpers").update({ session_state: "blocked" }).eq("helper_id", body.helperId).eq("boot_id", body.bootId);
    return new Response(null, { status: 204 });
  }
}
