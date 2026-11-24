import { NextResponse } from "next/server";
import { z } from "zod";
import { getXReplyWorkerSecret } from "@/lib/env";
import { isAuthorizedXReplyWorker } from "@/lib/x-reply-worker-auth";
import { decryptProxyUrl } from "@/lib/x-proxy-crypto";
import { MANUAL_HELPER_ID, MANUAL_SENDER_ID, MANUAL_SENDER_KEY, freshManualHelper } from "@/lib/x-account-manual";
import { manualDb, loadManualRoute } from "@/lib/x-account-manual-server";

export const runtime = "nodejs";
const input = z.object({ operation: z.enum(["register", "heartbeat", "claim", "complete", "stop"]),
  helperId: z.literal(MANUAL_HELPER_ID), bootId: z.string().uuid(), requestId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(), status: z.enum(["opened_manual_check", "blocked", "failed"]).optional(),
  sessionState: z.enum(["idle", "open", "blocked", "closed"]).optional(),
  routeRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(), expectedIp: z.string().max(64).optional(),
  message: z.string().max(300).optional() });

/** Dedicated helper only: never touches worker heartbeats, auto claim, approvals or cookies. */
export async function POST(request: Request) {
  if (!isAuthorizedXReplyWorker(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid manual helper request" }, { status: 400 });
  const body = parsed.data, db = manualDb(), now = new Date().toISOString();
  if (body.operation === "register") {
    const { data: existing } = await db.from("x_account_manual_helpers").select("*").eq("helper_id", body.helperId).maybeSingle();
    if (existing?.boot_id === body.bootId) return NextResponse.json({ bootedAt: existing.booted_at });
    const { error } = await db.from("x_account_manual_helpers").upsert({ helper_id: body.helperId, boot_id: body.bootId,
      booted_at: now, last_seen_at: now, status: "online", helper_version: "1.0.0-native-manual",
      session_id: null, route_revision: null, expected_ip: null, session_state: "idle" });
    return error ? NextResponse.json({ error: "Manual registration failed" }, { status: 503 }) : NextResponse.json({ bootedAt: now });
  }
  const { data: helper } = await db.from("x_account_manual_helpers").select("*").eq("helper_id", body.helperId).eq("boot_id", body.bootId).maybeSingle();
  if (!helper || !freshManualHelper(helper)) return NextResponse.json({ error: "Manual helper boot expired" }, { status: 409 });
  if (body.operation === "heartbeat" || body.operation === "stop") {
    if (body.operation === "heartbeat" && (!body.sessionState || body.sessionState === "open" && (!body.sessionId || !body.routeRevision || !body.expectedIp)))
      return NextResponse.json({ error: "Current local session state required" }, { status: 400 });
    const { error } = await db.from("x_account_manual_helpers").update({ last_seen_at: now, status: body.operation === "stop" ? "stopped" : "online",
      session_id: body.sessionId ?? null, route_revision: body.routeRevision ?? null, expected_ip: body.expectedIp ?? null,
      session_state: body.operation === "stop" ? "closed" : ["blocked", "closed"].includes(helper.session_state) ? helper.session_state : body.sessionState })
      .eq("helper_id", body.helperId).eq("boot_id", body.bootId);
    return error ? NextResponse.json({ error: "Manual heartbeat failed" }, { status: 503 }) : NextResponse.json({ ok: true });
  }
  if (body.operation === "complete") {
    if (!body.requestId || !body.status || body.status === "opened_manual_check" && !body.sessionId) return NextResponse.json({ error: "Invalid completion" }, { status: 400 });
    const { data, error } = await db.from("x_account_manual_open_requests").update({ status: body.status,
      session_id: body.sessionId ?? null, completed_at: now, message: body.message ?? null })
      .eq("id", body.requestId).eq("boot_id", body.bootId).eq("helper_id", body.helperId).eq("status", "opening").select("id").maybeSingle();
    if (body.status !== "opened_manual_check") await db.from("x_account_manual_helpers").update({ session_state: "blocked" })
      .eq("helper_id", body.helperId).eq("boot_id", body.bootId);
    return error || !data ? NextResponse.json({ error: "Completion no longer current" }, { status: 409 }) : NextResponse.json({ ok: true });
  }
  // Boot and expiry are checked both when reading and during the CAS. No pre-restart request is replayed.
  const { data: pending, error: readError } = await db.from("x_account_manual_open_requests").select("id,task_id,account_id,boot_id,route_revision,expected_ip,expires_at,created_at")
    .eq("helper_id", body.helperId).eq("boot_id", body.bootId).eq("status", "pending")
    .gte("created_at", helper.booted_at).gt("expires_at", now).order("created_at").limit(1).maybeSingle();
  if (readError) return NextResponse.json({ error: "Manual request unavailable" }, { status: 503 });
  if (!pending) return new Response(null, { status: 204 });
  const { data: claimed, error: claimError } = await db.from("x_account_manual_open_requests")
    .update({ status: "opening", claimed_at: now }).eq("id", pending.id).eq("boot_id", body.bootId)
    .eq("status", "pending").gte("created_at", helper.booted_at).gt("expires_at", now).select("id").maybeSingle();
  if (claimError || !claimed) return new Response(null, { status: 204 });
  try {
    const route = await loadManualRoute();
    const { data: task } = await db.from("x_account_manual_posts").select("id,status,account_id")
      .eq("id", pending.task_id).eq("account_id", MANUAL_SENDER_ID).eq("status", "draft").maybeSingle();
    if (!task || pending.account_id !== MANUAL_SENDER_ID || pending.route_revision !== route.revision || pending.expected_ip !== route.expectedIp)
      throw new Error("Task, sender or bound route changed; request blocked.");
    const secret = getXReplyWorkerSecret();
    if (!secret) throw new Error("Bound route unavailable.");
    return NextResponse.json({ request: { id: pending.id, taskId: task.id, bootId: body.bootId,
      expiresAt: pending.expires_at, createdAt: pending.created_at, accountId: MANUAL_SENDER_ID,
      accountKey: MANUAL_SENDER_KEY, routeRevision: route.revision, expectedIp: route.expectedIp,
      proxyUrl: decryptProxyUrl(route.encryptedProxy, secret) } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await db.from("x_account_manual_open_requests").update({ status: "blocked", completed_at: now,
      message: "任务、固定发送账号或网络绑定已变化，未打开窗口。" }).eq("id", pending.id).eq("status", "opening");
    await db.from("x_account_manual_helpers").update({ session_state: "blocked" }).eq("helper_id", body.helperId).eq("boot_id", body.bootId);
    return new Response(null, { status: 204 });
  }
}
