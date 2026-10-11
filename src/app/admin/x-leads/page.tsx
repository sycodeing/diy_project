import { createHmac } from "node:crypto";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { CopyButton, CopyField } from "@/components/copy-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { getAppUrl, getMarketingIngestSecret } from "@/lib/env";
import { getMarketingPreviewUrls } from "@/lib/marketing";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { formatAdminDate, getServerNowMillis } from "@/lib/utils";
import {
  createXLeadDrafts,
  getXLeadFunnelStatus,
  X_LEAD_SEGMENT_LABELS,
  X_LEAD_STATUS_LABELS,
  type XLeadRow,
} from "@/lib/x-lead";
import { generateXLeadMarketingLink } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function XLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; segment?: string; notice?: string }>;
}) {
  await requireAdmin("/admin/x-leads");
  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return <AppShell admin><main className="mx-auto w-full max-w-3xl px-4 py-10"><SetupWarning /></main></AppShell>;
  }
  const filters = await searchParams;
  let query = supabase
    .from("x_leads")
    .select("id,post_id,x_handle,post_url,media_url,posted_at,discovered_at,selection_status,segment,occasion,occasion_confidence,ownership_confidence,us_confidence,us_evidence,lead_score,like_count,reply_count,repost_count,view_count,followers_count,consent_copy,public_copy,direct_message_copy,marketing_link_id,marketing_links!x_leads_marketing_link_id_fkey(id,idempotency_key,source_hash,expires_at,account_user_id,account_was_created,marketing_events(event_type,created_at),orders(id,payment_status,paid_at))")
    .order("discovered_at", { ascending: false })
    .limit(100);
  if (filters.status) query = query.eq("selection_status", filters.status);
  if (filters.segment) query = query.eq("segment", filters.segment);
  const { data, error } = await query;
  const leads = (data ?? []) as unknown as XLeadRow[];
  const secret = getMarketingIngestSecret();
  const appUrl = getAppUrl();
  const renderedAt = getServerNowMillis();
  const cards = await Promise.all(leads.map(async (lead) => {
    const link = lead.marketing_links;
    const url = secret && link
      ? `${appUrl}/go/${createHmac("sha256", secret).update(`marketing-link:${link.idempotency_key}`).digest("base64url")}`
      : null;
    const previews = link && new Date(link.expires_at).getTime() > renderedAt
      ? await getMarketingPreviewUrls(link.source_hash, link.expires_at)
      : [];
    return { lead, url, preview: previews[0]?.url ?? null };
  }));
  const noticeText = filters.notice === "generated"
    ? "专属链接、营销文案和预览图已生成。"
    : filters.notice === "not-eligible"
      ? "该用户已被拒绝或加入不再联系名单，不能生成链接。"
      : null;

  return (
    <AppShell admin>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black">X 用户</h1>
            <p className="mt-2 text-sm text-muted">查看来源帖子、生成专属网站链接，并跟踪从点击到付款的状态。</p>
          </div>
          <Link className="focus-ring rounded-lg border border-line px-4 py-2 font-bold hover:bg-surface" href="/admin/x-lead-search">筛选设置</Link>
        </div>
        {noticeText ? <p className="mt-5 rounded-lg border border-line bg-panel p-3 text-sm font-bold">{noticeText}</p> : null}

        <form className="mt-6 grid gap-3 rounded-xl border border-line bg-panel/90 p-4 sm:grid-cols-[1fr_1fr_auto]">
          <SelectFilter label="筛选状态" name="status" value={filters.status ?? ""} options={[["", "全部状态"], ...Object.entries(X_LEAD_STATUS_LABELS)]} />
          <SelectFilter label="目标人群" name="segment" value={filters.segment ?? ""} options={[["", "全部人群"], ["new_adoption", X_LEAD_SEGMENT_LABELS.new_adoption], ["pet_birthday", X_LEAD_SEGMENT_LABELS.pet_birthday]]} />
          <button className="focus-ring mt-auto h-11 rounded-lg bg-accent px-5 font-black text-accent-ink" type="submit">筛选</button>
        </form>

        {error ? <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">读取 X 用户失败：{error.message}</p> : null}
        <div className="mt-6 space-y-5">
          {cards.map(({ lead, url, preview }) => {
            const drafts = createXLeadDrafts(lead.segment, url ?? "{link}");
            const eligible = !["rejected_targeting", "rejected", "suppressed"].includes(lead.selection_status);
            const expired = Boolean(lead.marketing_links && new Date(lead.marketing_links.expires_at).getTime() <= renderedAt);
            return <article className="overflow-hidden rounded-xl border border-line bg-panel/90" key={lead.id}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <a className="font-black text-accent" href={lead.post_url} rel="noreferrer" target="_blank">@{lead.x_handle}</a>
                  <span className="rounded-md border border-line bg-white px-2 py-1 text-xs font-bold">{X_LEAD_SEGMENT_LABELS[lead.segment] ?? lead.segment}</span>
                  <span className="rounded-md bg-accent-soft px-2 py-1 text-xs font-black text-accent-strong">{getXLeadFunnelStatus(lead)}</span>
                </div>
                <span className="text-xs text-muted">发现于 {formatAdminDate(lead.discovered_at)}</span>
              </div>
              <div className="grid gap-5 p-4 lg:grid-cols-[180px_minmax(0,1fr)_minmax(280px,0.9fr)]">
                <div>
                  <div className="aspect-square overflow-hidden rounded-lg border border-line bg-surface">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt={`@${lead.x_handle} 的帖子图片`} className="h-full w-full object-cover" src={lead.media_url} />
                  </div>
                  <a className="mt-3 inline-block text-sm font-bold text-accent" href={lead.post_url} rel="noreferrer" target="_blank">打开对应帖子 ↗</a>
                </div>

                <div>
                  <h2 className="text-lg font-black">用户与筛选信息</h2>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <Metric label="筛选状态" value={X_LEAD_STATUS_LABELS[lead.selection_status] ?? lead.selection_status} />
                    <Metric label="综合评分" value={lead.lead_score === null ? "待图片分析" : `${lead.lead_score} 分`} />
                    <Metric label="美国位置可信度" value={`${lead.us_confidence ?? 0} 分`} />
                    <Metric label="主人意图可信度" value={`${lead.ownership_confidence ?? 0} 分`} />
                    <Metric label="点赞 / 回复" value={`${lead.like_count} / ${lead.reply_count}`} />
                    <Metric label="粉丝数" value={String(lead.followers_count)} />
                  </dl>
                  <p className="mt-3 text-xs leading-5 text-muted">位置证据：{lead.us_evidence ?? "无公开位置证据"}</p>
                </div>

                <aside className="rounded-lg border border-line bg-white p-4">
                  <h2 className="font-black">专属营销素材</h2>
                  {preview ? <div className="mt-3 overflow-hidden rounded-lg border border-line bg-surface">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="专属抱枕预览图" className="aspect-square w-full object-cover" src={preview} />
                  </div> : null}
                  {url && !expired ? <>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a className="focus-ring inline-flex h-9 items-center rounded-md bg-accent px-3 text-xs font-black text-accent-ink" href={url} rel="noreferrer" target="_blank">打开专属链接</a>
                      <CopyButton label="一键复制链接" value={url} />
                    </div>
                    <div className="mt-3"><CopyField label="私信营销文案" multiline value={lead.direct_message_copy ?? drafts.directMessageCopy} /><CopyField label="公开回复文案" multiline value={lead.public_copy ?? drafts.publicCopy} /><CopyField label="征求同意文案" multiline value={lead.consent_copy ?? drafts.consentCopy} /></div>
                  </> : eligible ? <form action={generateXLeadMarketingLink} className="mt-3">
                    <input name="leadId" type="hidden" value={lead.id} />
                    <FormSubmitButton className="focus-ring h-11 w-full rounded-lg bg-accent px-4 font-black text-accent-ink disabled:cursor-not-allowed disabled:opacity-50" idleLabel={expired ? "重新生成链接、文案和预览图" : "生成链接、文案和预览图"} pendingLabel="正在生成预览图…" />
                  </form> : <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">该用户未通过筛选，已禁止生成专属素材。</p>}
                </aside>
              </div>
            </article>;
          })}
          {!cards.length ? <div className="rounded-xl border border-line bg-panel/90 p-10 text-center"><p className="text-lg font-black">还没有符合条件的 X 用户。</p><p className="mt-2 text-sm text-muted">先到“X 用户筛选”页启动任务；本机执行器完成后，结果会显示在这里。</p></div> : null}
        </div>
      </main>
    </AppShell>
  );
}

function SelectFilter({ label, name, value, options }: { label: string; name: string; value: string; options: Array<[string, string]> }) {
  return <label className="block text-sm font-bold">{label}<select className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" defaultValue={value} name={name}>{options.map(([optionValue, optionLabel]) => <option key={optionValue || "all"} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-line bg-surface p-3"><dt className="text-xs font-bold text-muted">{label}</dt><dd className="mt-1 font-black">{value}</dd></div>;
}

