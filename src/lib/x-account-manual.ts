export const ACCOUNT_MANUAL_PATH = "/admin/x-account-manual-posts";
export const MANUAL_SENDER_ID = "648f2feb-3820-4306-8192-184444ef7cb8";
export const MANUAL_SENDER_KEY = "Le6wCummeratawi";
export const MANUAL_SENDER_LABEL = "theBestDiy / @Le6wCummeratawi";
export const MANUAL_HELPER_ID = "macbook-account-manual-01";
export const MANUAL_HELPER_CAPABILITY = "xuse-manual-read-v2";
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

export function manualReportError(input: { contentMode: string; resultUrl: string; personallySent: boolean; previewUploaded: boolean }): string | null {
  if (!input.personallySent || !canonicalManualResultUrl(input.resultUrl)) return "请确认本人已使用指定账号发送，并填写该账号的真实结果链接。";
  if (input.contentMode === "account_product_preview" && !input.previewUploaded) return "图文任务须由本人确认已在该回复上传所示商品预览图。";
  return null;
}

export function freshManualHelper(helper: { boot_id: string; booted_at: string; last_seen_at: string; status: string; helper_version?: string } | null, now = Date.now()) {
  if (!helper || helper.status !== "online" || helper.helper_version !== MANUAL_HELPER_CAPABILITY) return false;
  const seen = Date.parse(helper.last_seen_at), booted = Date.parse(helper.booted_at);
  return Number.isFinite(seen) && Number.isFinite(booted) && booted <= seen
    && seen <= now + 5_000 && now - seen < MANUAL_HELPER_MAX_AGE_MS;
}

export function manualWindowBlockReason(helper: { boot_id: string; booted_at: string; last_seen_at: string; status: string; helper_version?: string; session_state?: string; route_revision?: string | null; expected_ip?: string | null } | null, revision: string, expectedIp: string) {
  if (!freshManualHelper(helper)) return "x-use 手动助手未在线或版本不兼容；不会启动自动执行器或积压开窗请求。";
  if (["blocked", "closed"].includes(helper!.session_state ?? "")) return "原绑定会话已关闭或阻断；请本人核对后显式处理助手，不会自动重开。";
  if (helper!.session_state === "open" && (helper!.route_revision !== revision || helper!.expected_ip !== expectedIp))
    return "当前绑定与已有会话不一致；保留原窗口，不切网或另建会话。";
  return null;
}

export function manualRequestPurposeValid(purpose: unknown, taskId: unknown) {
  return purpose === "manual_task_x_home" ? typeof taskId === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(taskId)
    : purpose === "account_x_home" && taskId === null;
}
