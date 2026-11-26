export const ACCOUNT_MANUAL_PATH = "/admin/x-account-manual-posts";
export const MANUAL_SENDER_ID = "648f2feb-3820-4306-8192-184444ef7cb8";
export const MANUAL_SENDER_KEY = "Le6wCummeratawi";
export const MANUAL_SENDER_LABEL = "theBestDiy / @Le6wCummeratawi";
export const MANUAL_HELPER_ID = "macbook-account-manual-01";
export const MANUAL_HELPER_CAPABILITY = "xuse-manual-read-v3";
export const MANUAL_HELPER_MAX_AGE_MS = 45_000;

export type ManualSnapshot = {
  queue_version: number; content_mode: string; target_author_id: string;
  account_draft_author_id: string; source_post_id: string; target_post_url: string;
  reply_text: string; marketing_link_id: string; draft_generated_at: string;
  account_artwork_path?: string | null; account_artwork_hash?: string | null;
  account_preview_path?: string | null; account_preview_hash?: string | null;
  account_preview_template_id?: string | null;
  product_slug_snapshot?: string | null; product_match_reason_snapshot?: string | null;
};
export type AccountManualPost = {
  id: string; source_v2_job_id: string | null; source_account_id: string | null;
  account_id: string; target_author_id: string; target_handle: string;
  source_post_id: string; target_post_url: string; reply_text: string;
  status: "draft" | "reported" | "discarded"; snapshot: ManualSnapshot;
  created_at: string; result_url: string | null; reported_at: string | null;
};

export function manualSenderMatches(sender: { id: string; account_key: string; active: boolean; network_mode: string }) {
  return sender.id === MANUAL_SENDER_ID && sender.account_key === MANUAL_SENDER_KEY
    && sender.active && sender.network_mode === "fixed_proxy";
}

export function canonicalManualResultUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname)
      || url.username || url.password || url.port) return null;
    const match = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,30})\/?$/.exec(url.pathname);
    if (!match || match[1].toLowerCase() !== MANUAL_SENDER_KEY.toLowerCase()) return null;
    return `https://x.com/${MANUAL_SENDER_KEY}/status/${match[2]}`;
  } catch { return null; }
}

export function manualReportError(input: { resultUrl: string }): string | null {
  if (!canonicalManualResultUrl(input.resultUrl)) return "请填写指定账号的真实结果链接。";
  return null;
}

export function freshManualHelper(helper: { boot_id: string; booted_at: string; last_seen_at: string; status: string; helper_version?: string } | null, now = Date.now()) {
  if (!helper || helper.status !== "online" || helper.helper_version !== MANUAL_HELPER_CAPABILITY) return false;
  const seen = Date.parse(helper.last_seen_at), booted = Date.parse(helper.booted_at);
  return Number.isFinite(seen) && Number.isFinite(booted) && booted <= seen
    && seen <= now + 5_000 && now - seen < MANUAL_HELPER_MAX_AGE_MS;
}

export function manualWindowBlockReason(helper: { boot_id: string; booted_at: string; last_seen_at: string; status: string; helper_version?: string; session_state?: string; route_revision?: string | null; expected_ip?: string | null } | null, revision: string, expectedIp: string) {
  if (helper?.helper_version && helper.helper_version !== MANUAL_HELPER_CAPABILITY) return "原手动助手版本较旧；保留已有窗口，待本人关闭后更新助手，不会克隆会话。";
  if (helper?.status === "stopped") return "手动助手已停止接收请求；已有窗口可能仍在保留，不会自动重启或重建会话。";
  if (!freshManualHelper(helper)) return "x-use 手动助手未在线或版本不兼容；不会启动自动执行器或积压开窗请求。";
  if (["blocked", "closed"].includes(helper!.session_state ?? "")) return "原绑定会话已关闭或阻断；请本人核对后显式处理助手，不会自动重开。";
  if (helper!.session_state === "open" && (helper!.route_revision !== revision || helper!.expected_ip !== expectedIp))
    return "当前绑定与已有会话不一致；保留原窗口，不切网或另建会话。";
  return null;
}

export function manualRequestPurposeValid(purpose: unknown, taskId: unknown) {
  return ["manual_task_x_home", "manual_task_x_post"].includes(String(purpose)) ? typeof taskId === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(taskId)
    : purpose === "account_x_home" && taskId === null;
}

export function canonicalManualTargetUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{5,30}$/.test(value) ? value : null;
}

export function manualHelperRegistrationBlocked(existing: { boot_id: string; session_id?: string | null; session_state?: string } | null, bootId: string) {
  return Boolean(existing && existing.boot_id !== bootId && existing.session_id && existing.session_state !== "closed");
}

export function manualHelperLifecycleUpdate(helper: Record<string, unknown>, body: {
  operation: "heartbeat" | "stop"; sessionId?: string; routeRevision?: string; expectedIp?: string;
  ownerHandle?: string; sessionState?: string;
}, now: string) {
  const stopped = body.operation === "stop";
  return { last_seen_at: now, status: stopped ? "stopped" : "online",
    session_id: body.sessionId ?? (stopped ? helper.session_id : null),
    route_revision: body.routeRevision ?? (stopped ? helper.route_revision : null),
    expected_ip: body.expectedIp ?? (stopped ? helper.expected_ip : null),
    observed_x_handle: body.ownerHandle ?? (stopped ? helper.observed_x_handle : null),
    session_state: stopped && body.sessionState === "closed" ? "closed"
      : ["blocked", "closed"].includes(String(helper.session_state)) ? helper.session_state : body.sessionState ?? helper.session_state };
}

/** Only a never-started idle owner may renew its backend lease after sleep. */
export function canRenewIdleManualHeartbeat(helper: { status: string; session_state?: string; session_id?: string | null }, body: {
  operation: string; sessionState?: string; sessionId?: string; idleNeverStarted?: boolean;
}) {
  return body.operation === "heartbeat" && body.idleNeverStarted === true && body.sessionState === "idle"
    && !body.sessionId && helper.status === "online" && helper.session_state === "idle" && !helper.session_id;
}

export function manualRequestPreventsIdleRenewal(request: { status: string; claimed_at?: string | null }) {
  return Boolean(request.claimed_at) || !["pending", "failed"].includes(request.status);
}
