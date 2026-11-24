type QueueDraft = {
  status: string; review_status: string; marketing_expires_at: string | null;
  product_slug: string | null; selected_post_created_at: string | null;
  reply_text: string | null; marketing_url: string | null;
};
type QueueAccount = {
  review_status: string; account_status: string; entry_status: string;
  account_evidence: unknown;
};

/** Display gate only; the manual action performs the authoritative live checks. */
export function accountV2QueueEligibility(input: {
  draft: QueueDraft | null | undefined; account: QueueAccount; activeSlugs: ReadonlySet<string>;
  hasActiveQueueJob: boolean; nowMs: number;
}): { ready: boolean; reason: string } {
  const { draft, account, activeSlugs, hasActiveQueueJob, nowMs } = input;
  if (hasActiveQueueJob) return { ready: false, reason: "该账号已有队列或联系记录。" };
  if (!draft) return { ready: false, reason: "尚无草稿；请先生成。" };
  if (draft.status !== "draft_ready") return { ready: false, reason: "当前草稿没有可用的商品回复；请查看原因并补证或重生成。" };
  if (draft.review_status !== "unreviewed" || account.review_status === "dismissed"
    || account.account_status === "excluded" || account.entry_status === "hold"
    || account.account_evidence && typeof account.account_evidence === "object"
      && !Array.isArray(account.account_evidence)
      && Boolean((account.account_evidence as Record<string, unknown>).exclusion_reason))
    return { ready: false, reason: "账号或草稿已忽略、排除或暂缓；请核实后重生成。" };
  if (!draft.product_slug || !activeSlugs.has(draft.product_slug) || !draft.reply_text || !draft.marketing_url)
    return { ready: false, reason: "商品或草稿内容不可用；请重生成并复核。" };
  const linkExpiry = Date.parse(draft.marketing_expires_at ?? "");
  if (!Number.isFinite(linkExpiry) || linkExpiry <= nowMs + 24 * 60 * 60_000)
    return { ready: false, reason: "追踪链接不足 24 小时有效期；请重生成后加入。" };
  const postTime = Date.parse(draft.selected_post_created_at ?? "");
  if (!Number.isFinite(postTime) || postTime > nowMs + 5 * 60_000 || nowMs - postTime > 14 * 24 * 60 * 60_000)
    return { ready: false, reason: "所选本人帖已过期或时间待核；请重生成并复核。" };
  return { ready: true, reason: "" };
}
