import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { formatAdminDate } from "@/lib/utils";
import {
  describeUsEvidence,
  filterXLeadsForQueue,
  getXLeadReferenceConclusion,
  getXLeadReviewEvidence,
  getXLeadTargetingChecks,
  getXLeadFunnelStatus,
  getXLeadPriorityScore,
  getXLeadRejectionNote,
  getXLeadRejectionReason,
  sortXLeadsByPriority,
  X_LEAD_CONCLUSION_LABELS,
  X_LEAD_REJECTION_REASON_LABELS,
  X_LEAD_REJECTION_REASONS,
  X_LEAD_SEGMENT_LABELS,
  type XLeadConclusion,
  type XLeadRow,
} from "@/lib/x-lead";
import { CandidateActions } from "./candidate-actions";
import { CandidateMediaPicker } from "./candidate-media-picker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ManualQueueTaskSummary = {
  id: string;
  status: string;
  preparation_status: string;
  created_at: string;
};

export default async function XLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ conclusion?: string; segment?: string; review?: string; reason?: string; notice?: string }>;
}) {
  await requireAdmin("/admin/x-leads");
  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return <AppShell admin><main className="mx-auto w-full max-w-3xl px-4 py-10"><SetupWarning /></main></AppShell>;
  }
  const filters = await searchParams;
  let query = supabase
    .from("x_leads")
    .select("id,post_id,x_handle,post_url,media_url,media_urls,posted_at,discovered_at,selection_status,segment,pet_type,occasion,occasion_confidence,ownership_confidence,us_confidence,us_evidence,lead_score,like_count,reply_count,repost_count,view_count,followers_count,targeting_data,consent_copy,public_copy,direct_message_copy,marketing_link_id,marketing_links!x_leads_marketing_link_id_fkey(id,idempotency_key,source_hash,expires_at,account_user_id,account_was_created,marketing_events(event_type,created_at),orders(id,payment_status,paid_at)),x_manual_posts(id,status,preparation_status,created_at)")
    .in("pet_type", ["cat", "dog"])
    .order("discovered_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1000);
  if (filters.segment) query = query.eq("segment", filters.segment);
  if (filters.review === "rejected" || filters.reason) query = query.eq("selection_status", "rejected");
  else if (filters.review !== "all") query = query.neq("selection_status", "rejected");
  const [{ data, error }, { count: activeAccountCount, error: accountsError }, { data: searchConfig }, { data: rejectedRows }] = await Promise.all([
    query,
    supabase.from("x_reply_accounts").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("x_lead_search_configs").select("us_min_confidence").eq("config_key", "default").maybeSingle(),
    supabase.from("x_leads").select("targeting_data").eq("selection_status", "rejected").limit(1000),
  ]);
  const leadsWithManualTasks = (data ?? []) as unknown as Array<XLeadRow & { x_manual_posts: ManualQueueTaskSummary[] | null }>;
  const manualTaskByLeadId = new Map(leadsWithManualTasks.flatMap((lead) => {
    const task = lead.x_manual_posts?.toSorted((left, right) => right.created_at.localeCompare(left.created_at))[0];
    return task ? [[lead.id, task] as const] : [];
  }));
  const allLeads = leadsWithManualTasks as XLeadRow[];
  const reasonFilteredLeads = filters.reason && filters.reason in X_LEAD_REJECTION_REASON_LABELS
    ? allLeads.filter((lead) => getXLeadRejectionReason(lead) === filters.reason)
    : allLeads;
  const usMinConfidence = searchConfig?.us_min_confidence ?? 70;
  const conclusionFilter = filters.conclusion || (filters.review === "rejected" || filters.review === "all" || filters.reason ? "all" : "");
  const filteredLeads = filterXLeadsForQueue(reasonFilteredLeads, conclusionFilter, usMinConfidence);
  const leads = sortXLeadsByPriority(filteredLeads, usMinConfidence);
  const conclusionCounts = new Map<XLeadConclusion, number>();
  for (const lead of reasonFilteredLeads) {
    const conclusion = getXLeadReferenceConclusion(lead, usMinConfidence);
    conclusionCounts.set(conclusion, (conclusionCounts.get(conclusion) ?? 0) + 1);
  }
  const rejectionCounts = new Map<string, number>();
  for (const row of (rejectedRows ?? []) as Array<Pick<XLeadRow, "targeting_data">>) {
    const reason = getXLeadRejectionReason(row);
    rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
  }
  const noticeText = filters.notice === "not-eligible"
      ? "该用户已被拒绝或加入不再联系名单，不能生成链接。"
      : null;

  return (
    <AppShell admin>
      <main className="mx-auto w-full max-w-[1760px] flex-1 px-3 py-6 sm:px-5 2xl:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-accent-strong">发送任务入口</p>
            <h1 className="mt-1 text-4xl font-black">X 待处理用户与帖子</h1>
            <p className="mt-2 text-sm text-muted">第一期只处理猫、狗；这里完成筛选和入队，链接、文案与预览图在队列中异步生成。</p>
          </div>
          <Link className="focus-ring rounded-lg border border-line px-4 py-2 font-bold hover:bg-surface" href="/admin/x-lead-search">筛选设置</Link>
        </div>
        {noticeText ? <p className="mt-5 rounded-lg border border-line bg-panel p-3 text-sm font-bold">{noticeText}</p> : null}

        <section className="mt-5 rounded-xl border border-line bg-panel/90 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs leading-5">
            <span className="font-black">参考规则</span>
            <span><b>硬性：</b>猫或狗、美国位置至少 {usMinConfidence} 分、非机构广告</span>
            <span><b>人工：</b>本人宠物关系、领养/生日语义、图片适用性</span>
            <span className="text-muted">参考结论用于筛选，不会自动发送。</span>
          </div>
        </section>

        {rejectionCounts.size ? <section className="mt-5 rounded-xl border border-line bg-panel/90 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-black">人工过滤原因统计</h2><span className="text-xs text-muted">共 {Array.from(rejectionCounts.values()).reduce((sum, count) => sum + count, 0)} 条</span></div>
          <div className="mt-3 flex flex-wrap gap-2">{Array.from(rejectionCounts.entries()).toSorted((left, right) => right[1] - left[1]).map(([reason, count]) => <Link className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-xs font-bold" href={`/admin/x-leads?review=rejected&reason=${encodeURIComponent(reason)}`} key={reason}>{X_LEAD_REJECTION_REASON_LABELS[reason] ?? reason}：{count}</Link>)}</div>
          <p className="mt-3 text-xs text-muted">优先优化数量最高的原因：调整搜索词、位置阈值或图片规则后，再比较新一批候选的原因占比。</p>
        </section> : null}

        <form className="mt-6 grid gap-3 rounded-xl border border-line bg-panel/90 p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <SelectFilter label="参考结论" name="conclusion" value={conclusionFilter} options={[["", "待处理（建议 + 人工判断）"], ...Object.entries(X_LEAD_CONCLUSION_LABELS), ["all", "全部结论"]]} />
          <SelectFilter label="目标人群" name="segment" value={filters.segment ?? ""} options={[["", "全部人群"], ...Object.entries(X_LEAD_SEGMENT_LABELS)]} />
          <SelectFilter label="人工筛选" name="review" value={filters.review ?? ""} options={[["", "未标记不合适"], ["rejected", "只看已标记不合适"], ["all", "全部人工状态"]]} />
          <SelectFilter label="过滤原因" name="reason" value={filters.reason ?? ""} options={[["", "全部原因"], ...X_LEAD_REJECTION_REASONS.map((reason) => [reason, X_LEAD_REJECTION_REASON_LABELS[reason]] as [string, string]), ["legacy", X_LEAD_REJECTION_REASON_LABELS.legacy]]} />
          <button className="focus-ring mt-auto h-11 rounded-lg bg-accent px-5 font-black text-accent-ink" type="submit">筛选</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {(Object.entries(X_LEAD_CONCLUSION_LABELS) as Array<[XLeadConclusion, string]>).map(([conclusion, label]) => <span className="rounded-md border border-line bg-white px-2.5 py-1.5 font-bold" key={conclusion}>{label}：{conclusionCounts.get(conclusion) ?? 0}</span>)}
        </div>

        {error || accountsError ? <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">读取候选列表失败：{error?.message ?? accountsError?.message}</p> : null}
        {!accountsError && !activeAccountCount ? <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">当前没有启用的自动发送账号，因此只能加入手动队列；手动队列不绑定账号。</p> : null}
        <div className="mt-6 space-y-5">
          {leads.map((lead) => {
            const targetingChecks = getXLeadTargetingChecks(lead, usMinConfidence);
            const reviewEvidence = getXLeadReviewEvidence(lead);
            const failedChecks = targetingChecks.filter((check) => !check.passed);
            const conclusion = getXLeadReferenceConclusion(lead, usMinConfidence);
            const actionable = conclusion === "recommended" || conclusion === "manual_review";
            const manualTask = manualTaskByLeadId.get(lead.id);
            return <article className="overflow-hidden rounded-xl border border-line bg-panel/90" key={lead.id}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <a className="font-black text-accent" href={lead.post_url} rel="noreferrer" target="_blank">@{lead.x_handle}</a>
                  <span className="rounded-md border border-line bg-white px-2 py-1 text-xs font-bold">{X_LEAD_SEGMENT_LABELS[lead.segment] ?? lead.segment}</span>
                  <span className="rounded-md bg-accent-soft px-2 py-1 text-xs font-black text-accent-strong">{getXLeadFunnelStatus(lead)}</span>
                </div>
                <span className="text-xs text-muted">发现于 {formatAdminDate(lead.discovered_at)}</span>
              </div>
              <div className="grid gap-4 p-4 lg:grid-cols-[140px_minmax(300px,0.72fr)_minmax(520px,1.55fr)]">
                <div>
                  <CandidateMediaPicker
                    handle={lead.x_handle}
                    leadId={lead.id}
                    locked={Boolean(manualTask || lead.marketing_link_id || ["approved", "contacted", "suppressed"].includes(lead.selection_status))}
                    mediaUrl={lead.media_url}
                    mediaUrls={lead.media_urls}
                  />
                  <a className="mt-2 inline-block text-xs font-bold text-accent" href={lead.post_url} rel="noreferrer" target="_blank">打开原帖 ↗</a>
                </div>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-black">候选摘要</h2>
                    <ConclusionBadge conclusion={conclusion} />
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-2 2xl:grid-cols-3">
                    <Metric label="宠物类型" value={lead.pet_type === "cat" ? "猫" : "狗"} />
                    <Metric label="美国位置" value={`${lead.us_confidence ?? 0} 分`} />
                    <Metric label="点赞 / 回复" value={`${lead.like_count} / ${lead.reply_count}`} />
                    <Metric label="粉丝数" value={String(lead.followers_count)} />
                    <Metric label="候选优先分" value={`${getXLeadPriorityScore(lead)} 分`} />
                  </dl>
                  <QualificationSummary checks={targetingChecks} reviewEvidence={reviewEvidence} locationEvidence={describeUsEvidence(lead.us_evidence)} />
                </div>

                <aside className="space-y-3 rounded-lg border border-line bg-white p-3">
                  <ReferenceConclusion conclusion={conclusion} failedChecks={failedChecks} reviewEvidence={reviewEvidence} />
                  <CandidateActions
                    actionable={actionable}
                    activeAccountCount={activeAccountCount ?? 0}
                    existingManualTaskLabel={manualTask ? describeManualQueueTask(manualTask) : undefined}
                    initialRejectionNote={getXLeadRejectionNote(lead)}
                    initialRejectionReason={getXLeadRejectionReason(lead)}
                    leadId={lead.id}
                    selectionStatus={lead.selection_status}
                  />
                </aside>
              </div>
            </article>;
          })}
          {!leads.length ? <div className="rounded-xl border border-line bg-panel/90 p-10 text-center"><p className="text-lg font-black">当前没有待处理且达到硬性条件的候选。</p><p className="mt-2 text-sm text-muted">列表不会继续混入不符合数据。可以启动新的筛选任务，或主动选择“全部结论”检查历史记录。</p></div> : null}
        </div>
      </main>
    </AppShell>
  );
}

function describeManualQueueTask(task: ManualQueueTaskSummary) {
  if (task.status === "sent") return "已加入手动队列 · 已登记发送";
  if (task.status === "discarded") return "已加入手动队列 · 已作废";
  if (task.preparation_status === "failed") return "已加入手动队列 · 准备失败";
  if (["pending", "processing"].includes(task.preparation_status)) return "已加入手动队列 · 素材准备中";
  return "已加入手动队列 · 待人工发送";
}
function SelectFilter({ label, name, value, options }: { label: string; name: string; value: string; options: Array<[string, string]> }) {
  return <label className="block text-sm font-bold">{label}<select className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" defaultValue={value} name={name}>{options.map(([optionValue, optionLabel]) => <option key={optionValue || "all"} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-line bg-surface px-2.5 py-2"><dt className="text-[11px] font-bold text-muted">{label}</dt><dd className="mt-0.5 text-sm font-black">{value}</dd></div>;
}

function ConclusionBadge({ conclusion }: { conclusion: XLeadConclusion }) {
  return <span className={`rounded-md border px-2 py-1 text-xs font-black ${conclusionTone(conclusion)}`}>{X_LEAD_CONCLUSION_LABELS[conclusion]}</span>;
}

function QualificationSummary({
  checks,
  reviewEvidence,
  locationEvidence,
}: {
  checks: ReturnType<typeof getXLeadTargetingChecks>;
  reviewEvidence: ReturnType<typeof getXLeadReviewEvidence>;
  locationEvidence: string;
}) {
  return <div className="mt-2 rounded-lg border border-line bg-white p-2.5 text-xs">
    <div className="flex flex-wrap gap-1.5">
      {checks.map((check) => <span className={`rounded-md border px-2 py-1 font-bold ${check.passed ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`} key={check.key}>{check.label}：{check.actual}</span>)}
    </div>
    <p className="mt-2 leading-5 text-muted">位置依据：{locationEvidence}</p>
    <div className="mt-1 space-y-1">
      {reviewEvidence.map((item) => <p className="leading-5" key={item.key}><b>{item.label}：</b>{item.evidence.length ? item.evidence.map((value) => `“${value}”`).join("、") : "未命中，查看原帖人工判断"}</p>)}
    </div>
  </div>;
}

function ReferenceConclusion({
  conclusion,
  failedChecks,
  reviewEvidence,
}: {
  conclusion: XLeadConclusion;
  failedChecks: ReturnType<typeof getXLeadTargetingChecks>;
  reviewEvidence: ReturnType<typeof getXLeadReviewEvidence>;
}) {
  const missingEvidence = reviewEvidence.filter((item) => item.evidence.length === 0).map((item) => item.label);
  const description = conclusion === "recommended"
    ? "硬性条件和两类文本证据均具备，建议优先人工查看原图与回复内容。"
    : conclusion === "manual_review"
      ? `硬性条件已通过，${missingEvidence.join("、") || "文本语义"}仍需人工判断。`
      : conclusion === "excluded"
        ? failedChecks.length ? `不符合：${failedChecks.map((check) => check.label).join("、")}。` : "该候选已被人工拒绝。"
        : conclusion === "contacted"
          ? "该候选已经加入发送流程，避免重复创建任务。"
          : "该用户已设置为不再联系。";
  return <div className={`rounded-lg border px-3 py-2.5 ${conclusionTone(conclusion)}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-black">参考结论</h2><span className="text-xs font-black">{X_LEAD_CONCLUSION_LABELS[conclusion]}</span></div>
    <p className="mt-1 text-xs leading-5">{description}</p>
  </div>;
}

function conclusionTone(conclusion: XLeadConclusion) {
  if (conclusion === "recommended") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (conclusion === "manual_review") return "border-amber-200 bg-amber-50 text-amber-900";
  if (conclusion === "excluded") return "border-red-200 bg-red-50 text-red-900";
  if (conclusion === "contacted") return "border-blue-200 bg-blue-50 text-blue-900";
  return "border-line bg-surface text-muted";
}
