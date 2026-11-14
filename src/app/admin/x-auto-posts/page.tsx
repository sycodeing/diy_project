import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, Monitor, Send } from "lucide-react";
import Link from "next/link";
import { AdminAsyncImage } from "@/components/admin-async-image";
import { AppShell } from "@/components/app-shell";
import { FormSubmitButton } from "@/components/form-submit-button";
import { IdleAutoRefresh } from "@/components/idle-auto-refresh";
import { QueueAutoRefresh } from "@/components/queue-auto-refresh";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { getMarketingReplyPreviewUrl } from "@/lib/marketing";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { cn, formatDate, getServerNowMillis } from "@/lib/utils";
import {
  X_ACTION_LABELS,
  X_REPLY_STATUS_LABELS,
  X_REPLY_STATUS_STYLES,
  isLatestXReplyBatchFailure,
  summarizeLatestXReplyBatch,
  type XReplyJob,
  type XReplyAccount,
  type XReplyAccountProxy,
  type XReplyDailyGate,
  type XReplyWorker,
} from "@/lib/x-reply";
import {
  authorizeXDailySending,
  pauseXDailySending,
  rejectXAutoDraft,
  requestBoundXJobInspection,
  resumeXDailySendingAfterUncertainReview,
  resumePausedXDailySending,
  retryXAutoPreparation,
  retryUnsentXAutoJob,
  stopXAutoBatch,
} from "./actions";
import { StartAllForm } from "./approval-form";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  "draft-created": "自动发送任务已加入队列；点击“开始全部发送”前不会发送。",
  "lead-added": "已从候选列表加入自动队列；点击“开始全部发送”前不会发送。",
  "all-started": "全部已就绪任务已启动；正在验证账号/IP 的账号会等待验证通过，其他账号继续发送。每个账号分别按 12 条休息 45 分钟。",
  "daily-authorized": "已确认今日首条效果；该账号今天的后续已批准任务可以自动发送。",
  "daily-reviewed-continue": "已记录人工核对；不确定任务不会重试，该账号今天剩余的已批准任务将继续发送。",
  "daily-paused": "该账号今天已暂停，Worker 不会再领取它的任务。",
  "daily-resumed": "该账号已恢复今日发送；只领取仍在队列中的任务，结果不确定的记录不会自动重试。",
  "inspection-requested": "已通知绑定 Mac；X 原帖将通过该账号绑定的 IP 和本地登录打开。",
  "inspection-already-active": "该原帖已经在等待打开或浏览窗口仍处于打开状态。",
  "batch-stopped": "本批尚未领取的任务已停止；正在执行的任务会记录实际结果。",
  "single-retry-queued": "已将这一条加入单条重试；本机会先对账原操作，其他任务仍按原暂停状态等待。",
};

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function formatShanghaiDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export default async function XAutoPostsPage({ searchParams }: { searchParams: Promise<{ notice?: string; count?: string }> }) {
  await requireAdmin("/admin/x-auto-posts");
  const supabase = getSupabaseServiceClient();
  if (!supabase) return <AppShell admin><main className="mx-auto w-full max-w-3xl px-4 py-10"><SetupWarning /></main></AppShell>;
  const filters = await searchParams;
  const [{ data: jobRows, error: jobsError }, { data: workerRows }, { data: accountRows }, { data: gateRows }, { count: legacySentCount }] = await Promise.all([
    supabase.from("x_reply_jobs").select("*,x_reply_accounts(account_key,display_name,positioning),x_leads(media_url,pet_type,marketing_links!x_leads_marketing_link_id_fkey(source_hash,expires_at))").order("created_at", { ascending: false }).limit(1000),
    supabase.from("x_reply_workers").select("*").order("last_seen_at", { ascending: false }),
    supabase.from("x_reply_accounts").select("*,x_reply_account_proxies(status,egress_ip)").eq("active", true).order("display_name"),
    supabase.from("x_reply_daily_gates").select("account_id,gate_date,status,first_job_id,first_sent_at,authorized_at").eq("gate_date", shanghaiToday()),
    supabase.from("x_manual_posts").select("id", { count: "exact", head: true }).eq("status", "sent"),
  ]);
  const jobs = (jobRows ?? []) as unknown as XReplyJob[];
  const latestBatch = summarizeLatestXReplyBatch(jobs);
  const cards = await Promise.all(jobs.map(async (job) => {
    const link = job.x_leads?.marketing_links;
    const preview = job.content_mode !== "first_contact_text" && job.preparation_status === "ready" && link
      ? await getMarketingReplyPreviewUrl(link.source_hash, link.expires_at)
      : null;
    return { job, preview: preview?.url ?? null };
  }));
  cards.sort((left, right) => {
    const leftPinned = isLatestXReplyBatchFailure(left.job, latestBatch?.approvedAt);
    const rightPinned = isLatestXReplyBatchFailure(right.job, latestBatch?.approvedAt);
    // Stable sort preserves the database's default created_at-desc order inside both groups.
    return Number(rightPinned) - Number(leftPinned);
  });
  const readyToStartCount = jobs.filter((job) => job.status === "draft" && job.preparation_status === "ready").length;
  const preparingToStartCount = jobs.filter((job) => job.status === "draft" && ["pending", "processing"].includes(job.preparation_status)).length;
  const workers = (workerRows ?? []) as XReplyWorker[];
  const renderedAt = getServerNowMillis();
  const freshWorkers = workers.filter((worker) => renderedAt - new Date(worker.last_seen_at).getTime() < 5 * 60_000);
  const workerByExecutor = new Map(freshWorkers.filter((worker) => worker.executor_id).map((worker) => [worker.executor_id as string, worker]));
  const executorOnline = freshWorkers.length > 0;
  const accounts = (accountRows ?? []) as Array<XReplyAccount & {
    x_reply_account_proxies: Pick<XReplyAccountProxy, "status" | "egress_ip"> | Array<Pick<XReplyAccountProxy, "status" | "egress_ip">> | null;
  }>;
  const gates = new Map(((gateRows ?? []) as XReplyDailyGate[]).map((gate) => [gate.account_id, gate]));
  const notice = filters.notice ? notices[filters.notice] : null;
  const inspectionRefreshActive = jobs.some((job) => ["pending", "running"].includes(job.inspection_status));

  return (
    <AppShell admin>
      <IdleAutoRefresh idleMs={30_000} />
      <QueueAutoRefresh active={inspectionRefreshActive} intervalMs={3_000} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-accent-strong">Mac x-use execution chain</p><h1 className="mt-1 text-4xl font-black">X 自动发送</h1><p className="mt-2 text-sm text-muted">从候选页选择账号并加入后，任务只会停留在这里；点击“开始全部发送”后，绑定 Mac 才会通过 x-use + Patchright 可见浏览器执行。Cookie 只保存在本机。</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <Link className="focus-ring rounded-lg bg-accent px-4 py-3 text-sm font-black text-accent-ink" href="/admin/x-lead-search">获取待筛选用户</Link>
            <div className={cn("rounded-lg border px-4 py-3 text-sm font-bold", executorOnline ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900")}>
              <Monitor className="mr-2 inline" size={17} />{executorOnline ? `Mac 执行器在线 · ${freshWorkers.map((worker) => worker.execution_mode).join(" / ")}` : "Mac 执行器离线"}
            </div>
          </div>
        </div>
        {notice ? <p className="mt-5 rounded-lg border border-line bg-panel p-3 text-sm font-bold">{notice}</p> : null}
        {jobsError ? <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{jobsError.message}</p> : null}
        <p className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950"><strong>加入队列不会立即发送。</strong>自动任务只从“X 待处理用户与帖子”选择账号后加入；等待全部素材准备完成，再点击本页的“开始全部发送”。启动后，成功任务之间随机等待 15–30 秒；每个账号分别累计，完成 12 条后该账号强制休息 45 分钟，其他账号可以继续。每日首条监督若启用，仍会在首条后等待确认；`observe` 模式只允许账号/IP 的只读验证，不能领取写任务。</p>
        {legacySentCount ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950"><strong>历史已发送记录仍在：</strong>启用本机自动发送前，已有 {legacySentCount} 条人工发送历史。<Link className="ml-1 font-black underline" href="/admin/x-manual-posts">打开历史记录</Link></p> : null}

        <section className="mt-6 rounded-xl border border-line bg-panel/90 p-5">
          <h2 className="text-xl font-black">今日首条监督（北京时间）</h2>
          <p className="mt-1 text-sm text-muted">Worker 在 `send` 模式下才会打开 x-use 可见浏览器；首条成功后立即停住，等你查看 X 页面并放行。</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {accounts.map((account) => {
              const gate = gates.get(account.id);
              const worker = account.executor_id ? workerByExecutor.get(account.executor_id) : undefined;
              const localAccount = Boolean(worker?.configured_accounts.includes(account.account_key));
              const proxyRelation = account.x_reply_account_proxies;
              const proxy = Array.isArray(proxyRelation) ? proxyRelation[0] : proxyRelation;
              const boundEgressIp = account.network_mode === "fixed_proxy" ? proxy?.egress_ip : account.expected_egress_ip;
              const egressMatches = account.network_mode === "fixed_proxy"
                ? Boolean(proxy?.status === "healthy" && proxy.egress_ip)
                : Boolean(account.expected_egress_ip && worker?.current_egress_ip === account.expected_egress_ip && worker.network_probe_status === "healthy");
              const status = !account.require_daily_first_confirmation ? "disabled" : gate?.status ?? "pending";
              const firstJob = gate?.first_job_id ? jobs.find((job) => job.id === gate.first_job_id) : undefined;
              const awaitingFirstConfirmation = status === "awaiting_confirmation" && Boolean(gate?.first_sent_at);
              const pausedByUncertainFirstJob = status === "paused" && firstJob?.status === "uncertain";
              const canResumePaused = status === "paused" && !["uncertain", "claimed"].includes(firstJob?.status ?? "");
              const confirmationNeedsInspection = awaitingFirstConfirmation || pausedByUncertainFirstJob;
              const inspectionActive = firstJob && ["pending", "running"].includes(firstJob.inspection_status);
              const inspectionCompleted = firstJob?.inspection_status === "completed";
              const label = status === "authorized" ? "今日已放行" : status === "awaiting_confirmation" ? (gate?.first_sent_at ? "首条已发，等待确认" : "首条正在发送") : status === "paused" ? "今日已暂停" : status === "disabled" ? "未启用监督" : "等待今日首条";
              return <div className="rounded-lg border border-line bg-white p-4" key={account.id}><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-black">{account.display_name}</p><p className="text-xs text-muted">{account.executor_id ?? "未绑定执行器"} · {account.network_mode}</p></div><span className="rounded-md border border-line px-2 py-1 text-xs font-bold">{label}</span></div><div className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2"><span>执行模式：{worker?.execution_mode ?? "离线"}</span><span>x-use：{worker?.xuse_available ? "正常" : "异常"}</span><span>本地账号：{localAccount ? "存在" : "缺失"}</span><span>账号绑定出口：{boundEgressIp ?? "未确认"}</span><span>网络：{egressMatches ? "匹配" : "未锁定或不匹配"}</span><span>该账号本轮：{account.batch_sent_count} / 12</span><span>账号休息：{account.cooldown_until && Date.parse(account.cooldown_until) > renderedAt ? `至 ${formatShanghaiDate(account.cooldown_until)}` : "未休息"}</span><span>检查：{worker?.network_probe_status ?? "unknown"}</span></div>{awaitingFirstConfirmation ? <p className="mt-3 rounded-md border border-blue-300 bg-blue-50 p-3 text-xs font-bold leading-5 text-blue-950">今日首条已经发出。可以先通过该账号的绑定 IP 打开结果页核对效果；放行操作始终可以直接执行。</p> : null}{pausedByUncertainFirstJob ? <p className="mt-3 rounded-md border border-orange-300 bg-orange-50 p-3 text-xs font-bold leading-5 text-orange-950">今日首条结果不确定。可以通过该账号的绑定 IP 打开对应原帖核对；确认未发出后，可在失败记录上单条重试；如只需放行其余任务，也可直接操作。</p> : null}{canResumePaused ? <p className="mt-3 rounded-md border border-blue-300 bg-blue-50 p-3 text-xs font-bold leading-5 text-blue-950">该账号已手动暂停。恢复后会继续领取剩余已批准任务；结果不确定的任务不会自动重试。</p> : null}{firstJob?.inspection_error ? <p className="mt-2 text-xs font-bold text-red-700">绑定 IP 打开失败：{firstJob.inspection_error}</p> : null}{account.require_daily_first_confirmation ? <div className="mt-3 flex flex-wrap gap-2">{confirmationNeedsInspection && firstJob ? <form action={requestBoundXJobInspection}><input name="jobId" type="hidden" value={firstJob.id} /><FormSubmitButton className="focus-ring h-9 rounded-md border border-orange-700 bg-white px-3 text-xs font-black text-orange-800" disabled={Boolean(inspectionActive)} idleLabel={inspectionActive ? "绑定 IP 浏览窗口打开中…" : inspectionCompleted ? "重新使用绑定 IP 打开确认页" : "使用绑定 IP 打开确认页"} pendingLabel="正在通知 Mac…" /></form> : null}{awaitingFirstConfirmation ? <form action={authorizeXDailySending}><input name="accountId" type="hidden" value={account.id} /><FormSubmitButton className="focus-ring h-9 rounded-md bg-accent px-3 text-xs font-black text-accent-ink" idleLabel="效果正常，放行今日后续" pendingLabel="正在放行…" /></form> : null}{pausedByUncertainFirstJob ? <form action={resumeXDailySendingAfterUncertainReview}><input name="accountId" type="hidden" value={account.id} /><FormSubmitButton className="focus-ring h-9 rounded-md bg-orange-700 px-3 text-xs font-black text-white" idleLabel="仅放行剩余任务（不重试此条）" pendingLabel="正在放行…" /></form> : null}{canResumePaused ? <form action={resumePausedXDailySending}><input name="accountId" type="hidden" value={account.id} /><FormSubmitButton className="focus-ring h-9 rounded-md bg-emerald-700 px-3 text-xs font-black text-white" idleLabel={firstJob?.status === "sent" ? "继续今日发送" : "恢复今日首条监督"} pendingLabel="正在恢复…" /></form> : null}{status !== "paused" ? <form action={pauseXDailySending}><input name="accountId" type="hidden" value={account.id} /><FormSubmitButton className="focus-ring h-9 rounded-md border border-line px-3 text-xs font-bold" idleLabel="暂停今日发送" pendingLabel="正在暂停…" /></form> : null}</div> : null}</div>;
            })}
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
            <h2 className="text-xl font-black text-blue-950">自动任务从候选列表创建</h2>
            <p className="mt-2 text-sm leading-6 text-blue-900">先在候选页查看用户、原帖图片、位置证据和评分，选择发送账号后加入自动队列。加入后不会发送；回到本页确认全部任务，再统一点击开始。</p>
            <Link className="focus-ring mt-5 inline-flex h-11 items-center rounded-lg bg-accent px-5 font-black text-accent-ink" href="/admin/x-leads">打开待处理用户与帖子</Link>
          </div>
          <div className="rounded-xl border border-line bg-panel/90 p-5"><h2 className="text-xl font-black">账号、执行器、文案与独立出口</h2><p className="mt-2 text-sm leading-6 text-muted">账号资料、Mac 执行器绑定和 VPN/固定代理策略在独立管理页维护；自动任务会在领取前和写入前两次校验浏览器出口。</p><Link className="focus-ring mt-5 inline-flex h-11 items-center rounded-lg border border-line px-5 font-black" href="/admin/x-accounts">管理 X 账号/IP</Link></div>
        </section>

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-black">自动发送队列与结果</h2><p className="mt-1 text-sm text-muted">先把候选任务加入并确认；点击开始后，Worker 串行发送，每条间隔 15–30 秒，每个账号各自每 12 条休息 45 分钟。</p></div><div className="flex max-w-full flex-wrap justify-end gap-2"><StartAllForm preparingCount={preparingToStartCount} readyCount={readyToStartCount} />{latestBatch?.active ? <form action={stopXAutoBatch}><input name="approvedAt" type="hidden" value={latestBatch.approvedAt} /><FormSubmitButton className="focus-ring h-11 rounded-lg bg-red-700 px-4 text-sm font-black text-white" idleLabel="立即停止本批发送" pendingLabel="正在停止…" /></form> : null}<Link className="focus-ring rounded-lg border border-line bg-white px-4 py-3 text-sm font-black" href="/admin/x-leads">返回候选列表</Link></div></div>
          <div aria-live="polite" className={cn("mt-4 rounded-xl border p-5", latestBatch?.state === "succeeded" ? "border-emerald-200 bg-emerald-50" : latestBatch?.state === "completed_with_issues" ? "border-amber-200 bg-amber-50" : "border-blue-200 bg-blue-50")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">最近一批发送状态</p>
                <h3 className="mt-1 text-xl font-black">
                  {!latestBatch ? "尚未开始批量发送" : latestBatch.state === "running" ? `发送处理中 · ${latestBatch.completed}/${latestBatch.total}` : latestBatch.state === "succeeded" ? `全部发送成功 · ${latestBatch.sent}/${latestBatch.total}` : `本批次已处理完成 · ${latestBatch.completed}/${latestBatch.total}`}
                </h3>
              </div>
              <span className="rounded-md border border-current/20 bg-white/70 px-3 py-1.5 text-xs font-bold">30 秒无操作自动刷新</span>
            </div>
            {latestBatch ? <>
              <div aria-label={`本批次已处理 ${latestBatch.progress}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={latestBatch.progress} className="mt-4 h-2 overflow-hidden rounded-full bg-white/80" role="progressbar"><div className={cn("h-full rounded-full transition-[width]", latestBatch.state === "succeeded" ? "bg-emerald-600" : latestBatch.state === "completed_with_issues" ? "bg-amber-600" : "bg-blue-600")} style={{ width: `${latestBatch.progress}%` }} /></div>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5"><span>总计：<strong>{latestBatch.total}</strong></span><span>确认已发送：<strong>{latestBatch.sent}</strong></span><span>处理中/等待：<strong>{latestBatch.active}</strong></span><span>失败：<strong>{latestBatch.failed}</strong></span><span>按未发送计/待核对：<strong>{latestBatch.uncertain}</strong></span></div>
              <p className="mt-3 text-xs text-muted">开始：{formatShanghaiDate(latestBatch.approvedAt)}{latestBatch.completedAt ? ` · 完成：${formatShanghaiDate(latestBatch.completedAt)}` : " · 完成后会在这里显示最终状态和时间"}</p>
            </> : <p className="mt-3 text-sm text-muted">点击右上方“开始全部发送”后，这里会显示该批任务的实时进度和最终结果。</p>}
          </div>
          <div className="mt-4 space-y-4">
            {cards.map(({ job, preview }) => {
              const preparing = ["pending", "processing"].includes(job.preparation_status);
              const preparationFailed = job.preparation_status === "failed";
              const xResultUrl = job.result_url ?? job.target_post_url;
              const inspectionActive = ["pending", "running"].includes(job.inspection_status);
              const xResultLabel = inspectionActive ? "绑定 IP 浏览窗口打开中…" : job.result_url ? "使用绑定 IP 查看已发送回复" : "使用绑定 IP 查看对应原帖";
              return <article className="rounded-xl border border-line bg-panel/90 p-5" key={job.id}>
                <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><span className={cn("rounded-md border px-2.5 py-1 text-xs font-black", X_REPLY_STATUS_STYLES[job.status])}>{X_REPLY_STATUS_LABELS[job.status] ?? job.status}</span><span className="rounded-md border border-line bg-white px-2.5 py-1 text-xs font-black">{X_ACTION_LABELS[job.action_type] ?? job.action_type}</span><strong>{job.x_reply_accounts?.display_name ?? job.account_key_snapshot ?? "未知账号"}</strong><span className="font-mono text-xs text-muted">{job.x_reply_accounts?.account_key ?? job.account_key_snapshot}</span></div><span className="text-xs text-muted"><Clock3 className="mr-1 inline" size={13} />创建 {formatDate(job.created_at)}</span></div>
                {xResultUrl ? <form action={requestBoundXJobInspection} className="mt-4"><input name="jobId" type="hidden" value={job.id} /><FormSubmitButton className="focus-ring h-10 rounded-lg bg-accent px-4 text-sm font-black text-accent-ink disabled:cursor-not-allowed disabled:opacity-60" disabled={inspectionActive} idleLabel={xResultLabel} pendingLabel="正在通知绑定 Mac…" /></form> : null}
                {job.inspection_error ? <p className="mt-2 text-xs font-bold text-red-700">绑定 IP 打开失败：{job.inspection_error}</p> : null}
                {preparing ? <div className="mt-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-5 text-sm font-bold text-blue-950"><LoaderCircle className="animate-spin" size={20} /><div><p>{job.content_mode === "first_contact_text" ? "正在生成首条接触文案（无链接、无样图）" : "正在准备素材"}</p><p className="mt-1 text-xs font-normal text-blue-800">准备完成前不能开始全部发送，页面会自动刷新。</p></div></div> : null}
                {preparationFailed ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p className="font-bold">{job.preparation_error ?? "营销素材生成失败。"}</p>{job.status === "draft" && !job.approved_at ? <form action={retryXAutoPreparation} className="mt-3"><input name="jobId" type="hidden" value={job.id} /><FormSubmitButton className="focus-ring h-9 rounded-md bg-red-700 px-3 text-xs font-black text-white disabled:opacity-50" idleLabel="重新生成首条接触文案" pendingLabel="正在重新入队…" /></form> : <p className="mt-2 text-xs">非草稿任务不自动改写或重试，请先人工核对。</p>}</div> : null}
                {job.preparation_status === "ready" ? <>
                  {job.content_mode === "first_contact_text" ? <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-sm">首条接触 · {job.copy_variant ?? "first_contact_v1"}：只发送下面的文字，不附图、不生成短链。样图能力保留供后续使用。需要本机执行器 4.8.0 或更新版本。</p> : null}
                  {job.x_leads && job.content_mode !== "first_contact_text" ? <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div><p className="mb-2 text-xs font-black text-muted">候选原帖图片</p><div className="aspect-square overflow-hidden rounded-lg border border-line bg-surface"><AdminAsyncImage alt="候选原帖图片" proxyThroughSite src={job.x_leads.media_url} /></div></div>
                    <div><p className="mb-2 text-xs font-black text-muted">自动生成的发送预览</p>{preview ? <div className="aspect-square overflow-hidden rounded-lg border border-line bg-surface"><AdminAsyncImage alt="自动生成的发送预览" src={preview} /></div> : <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">预览链接已失效或暂时不可用，请重新生成后再开始发送。</div>}</div>
                  </div> : null}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold">{job.status === "draft" ? "加入自动队列" : "进入发送队列"}（北京时间）：{formatShanghaiDate(job.scheduled_for)}</p></div>
                  <blockquote className="mt-3 whitespace-pre-wrap rounded-lg border border-line bg-white p-4 text-sm leading-6">{job.reply_text}</blockquote>
                  {job.status === "draft" && !job.approved_at && job.content_mode !== "first_contact_text" ? <form action={retryXAutoPreparation} className="mt-3"><input name="jobId" type="hidden" value={job.id} /><FormSubmitButton className="focus-ring rounded-lg border border-line px-3 py-2 text-sm font-bold" idleLabel="改为新版首条接触文案" pendingLabel="正在重新生成…" /></form> : null}
                  <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-3"><span>批准：{job.approved_at ? formatDate(job.approved_at) : "—"}</span><span>领取：{job.claimed_at ? formatDate(job.claimed_at) : "—"}</span><span>完成：{job.completed_at ? formatDate(job.completed_at) : "—"}</span></div>
                </> : null}
                {job.status === "draft" && job.preparation_status === "ready" ? <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-bold text-amber-950">已就绪，等待点击页面顶部“开始全部发送”。</p><form action={rejectXAutoDraft}><input name="jobId" type="hidden" value={job.id} /><button className="focus-ring h-10 rounded-lg border border-line bg-white px-4 text-sm font-bold" type="submit">移出自动队列</button></form></div> : null}
                {job.status === "sent" ? <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-900"><CheckCircle2 className="mr-2 inline" size={17} />x-use 已确认本次写操作成功；如需查看结果，请使用上方绑定 IP 入口。</p> : null}
                {job.status === "uncertain" ? <div className="mt-4 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm font-bold text-orange-950"><p><AlertTriangle className="mr-2 inline" size={17} />统计按未发送计，原始状态保留待核对。请先通过上方绑定 IP 入口确认 X 上没有发出，再单条重试。</p>{job.action_id ? <form action={retryUnsentXAutoJob} className="mt-3"><input name="jobId" type="hidden" value={job.id} /><FormSubmitButton className="focus-ring rounded-md bg-orange-700 px-4 py-2 text-sm font-black text-white" idleLabel="确认未发出，重试此条" pendingLabel="正在加入单条重试…" /></form> : null}</div> : null}
                {job.error_message ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{job.error_code ? `${job.error_code}: ` : ""}{job.error_message}</p> : null}
                {job.worker_id ? <p className="mt-3 text-xs text-muted"><Send className="mr-1 inline" size={13} />执行器：{job.worker_id}{job.egress_ip ? ` · 出口 ${job.egress_ip}` : ""}{job.xuse_draft_id ? ` · x-use draft ${job.xuse_draft_id}` : ""}{job.action_id ? ` · action ${job.action_id}` : ""}</p> : null}
              </article>;
            })}
            {!jobs.length ? <p className="rounded-xl border border-dashed border-line p-10 text-center text-muted">尚无自动发送记录。</p> : null}
          </div>
        </section>
      </main>
    </AppShell>
  );
}
