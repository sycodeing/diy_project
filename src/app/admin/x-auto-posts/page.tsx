import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, LoaderCircle, Monitor, Send } from "lucide-react";
import Link from "next/link";
import { AdminAsyncImage } from "@/components/admin-async-image";
import { AppShell } from "@/components/app-shell";
import { FormSubmitButton } from "@/components/form-submit-button";
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
  type XReplyJob,
  type XReplyAccount,
  type XReplyDailyGate,
  type XReplyWorker,
} from "@/lib/x-reply";
import {
  authorizeXDailySending,
  pauseXDailySending,
  rejectXAutoDraft,
  retryXAutoPreparation,
} from "./actions";
import { ApprovalForm } from "./approval-form";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  "draft-created": "自动发送草稿已创建，尚未批准，也不会发送。",
  "lead-added": "已从候选列表加入自动发送草稿，尚未批准，也不会发送。",
  approved: "已批准；Mac Worker 将立即领取并自动发送。",
  "batch-approved": "所选任务已批量批准；首条确认后，Worker 将按 3–7 秒随机间隔继续发送。",
  "daily-authorized": "已确认今日首条效果；该账号今天的后续已批准任务可以自动发送。",
  "daily-paused": "该账号今天已暂停，Worker 不会再领取它的任务。",
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
    supabase.from("x_reply_accounts").select("*").eq("active", true).order("display_name"),
    supabase.from("x_reply_daily_gates").select("account_id,gate_date,status,first_job_id,first_sent_at,authorized_at").eq("gate_date", shanghaiToday()),
    supabase.from("x_manual_posts").select("id", { count: "exact", head: true }).eq("status", "sent"),
  ]);
  const jobs = (jobRows ?? []) as unknown as XReplyJob[];
  const cards = await Promise.all(jobs.map(async (job) => {
    const link = job.x_leads?.marketing_links;
    const preview = job.preparation_status === "ready" && link
      ? await getMarketingReplyPreviewUrl(link.source_hash, link.expires_at)
      : null;
    return { job, preview: preview?.url ?? null };
  }));
  const isPreparing = jobs.some((job) => ["pending", "processing"].includes(job.preparation_status));
  const batchReadyCount = jobs.filter((job) => job.status === "draft" && job.preparation_status === "ready").length;
  const workers = (workerRows ?? []) as XReplyWorker[];
  const renderedAt = getServerNowMillis();
  const freshWorkers = workers.filter((worker) => renderedAt - new Date(worker.last_seen_at).getTime() < 5 * 60_000);
  const workerByExecutor = new Map(freshWorkers.filter((worker) => worker.executor_id).map((worker) => [worker.executor_id as string, worker]));
  const executorOnline = freshWorkers.length > 0;
  const accounts = (accountRows ?? []) as XReplyAccount[];
  const gates = new Map(((gateRows ?? []) as XReplyDailyGate[]).map((gate) => [gate.account_id, gate]));
  const notice = filters.notice ? notices[filters.notice] : null;

  return (
    <AppShell admin>
      <QueueAutoRefresh active={isPreparing} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-accent-strong">Mac x-use execution chain</p><h1 className="mt-1 text-4xl font-black">X 自动发送</h1><p className="mt-2 text-sm text-muted">每条内容先审核，计划时间到达后由绑定 Mac 的 x-use + Patchright 可见浏览器执行；Cookie 只保存在本机。</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <Link className="focus-ring rounded-lg bg-accent px-4 py-3 text-sm font-black text-accent-ink" href="/admin/x-lead-search">获取待筛选用户</Link>
            <div className={cn("rounded-lg border px-4 py-3 text-sm font-bold", executorOnline ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900")}>
              <Monitor className="mr-2 inline" size={17} />{executorOnline ? `Mac 执行器在线 · ${freshWorkers.map((worker) => worker.execution_mode).join(" / ")}` : "Mac 执行器离线"}
            </div>
          </div>
        </div>
        {notice ? <p className="mt-5 rounded-lg border border-line bg-panel p-3 text-sm font-bold">{notice}</p> : null}
        {jobsError ? <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{jobsError.message}</p> : null}
        <p className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950"><strong>发送队列隔离，候选池共用。</strong>自动任务只从“X 待处理用户与帖子”选择加入；素材准备完成后可逐条批准，也可勾选多条批量批准。每日首条仍会停下等待确认，放行后每次成功发送间隔随机 3–7 秒。`observe` 只上报状态，不能领取任务。</p>
        {legacySentCount ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950"><strong>历史已发送记录仍在：</strong>启用本机自动发送前，已有 {legacySentCount} 条人工发送历史。<Link className="ml-1 font-black underline" href="/admin/x-manual-posts">打开历史记录</Link></p> : null}

        <section className="mt-6 rounded-xl border border-line bg-panel/90 p-5">
          <h2 className="text-xl font-black">今日首条监督（北京时间）</h2>
          <p className="mt-1 text-sm text-muted">Worker 在 `send` 模式下才会打开 x-use 可见浏览器；首条成功后立即停住，等你查看 X 页面并放行。</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {accounts.map((account) => {
              const gate = gates.get(account.id);
              const worker = account.executor_id ? workerByExecutor.get(account.executor_id) : undefined;
              const localAccount = Boolean(worker?.configured_accounts.includes(account.account_key));
              const egressMatches = account.network_mode === "fixed_proxy" || Boolean(account.expected_egress_ip && worker?.current_egress_ip === account.expected_egress_ip && worker.network_probe_status === "healthy");
              const status = !account.require_daily_first_confirmation ? "disabled" : gate?.status ?? "pending";
              const label = status === "authorized" ? "今日已放行" : status === "awaiting_confirmation" ? (gate?.first_sent_at ? "首条已发，等待确认" : "首条正在发送") : status === "paused" ? "今日已暂停" : status === "disabled" ? "未启用监督" : "等待今日首条";
              return <div className="rounded-lg border border-line bg-white p-4" key={account.id}><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-black">{account.display_name}</p><p className="text-xs text-muted">{account.executor_id ?? "未绑定执行器"} · {account.network_mode}</p></div><span className="rounded-md border border-line px-2 py-1 text-xs font-bold">{label}</span></div><div className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2"><span>执行模式：{worker?.execution_mode ?? "离线"}</span><span>x-use：{worker?.xuse_available ? "正常" : "异常"}</span><span>本地账号：{localAccount ? "存在" : "缺失"}</span><span>当前出口：{worker?.current_egress_ip ?? "未确认"}</span><span>网络：{egressMatches ? "匹配" : "未锁定或不匹配"}</span><span>检查：{worker?.network_probe_status ?? "unknown"}</span></div>{account.require_daily_first_confirmation ? <div className="mt-3 flex gap-2">{status === "awaiting_confirmation" && gate?.first_sent_at ? <form action={authorizeXDailySending}><input name="accountId" type="hidden" value={account.id} /><FormSubmitButton className="focus-ring h-9 rounded-md bg-accent px-3 text-xs font-black text-accent-ink" idleLabel="效果正常，放行今日后续" pendingLabel="正在放行…" /></form> : null}<form action={pauseXDailySending}><input name="accountId" type="hidden" value={account.id} /><FormSubmitButton className="focus-ring h-9 rounded-md border border-line px-3 text-xs font-bold" idleLabel="暂停今日发送" pendingLabel="正在暂停…" /></form></div> : null}</div>;
            })}
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
            <h2 className="text-xl font-black text-blue-950">自动任务从候选列表创建</h2>
            <p className="mt-2 text-sm leading-6 text-blue-900">先在候选页查看用户、原帖图片、位置证据和评分，再加入自动队列；本页核对生成的预览图、最终文案、账号和计划时间后逐条批准。</p>
            <Link className="focus-ring mt-5 inline-flex h-11 items-center rounded-lg bg-accent px-5 font-black text-accent-ink" href="/admin/x-leads">打开待处理用户与帖子</Link>
          </div>
          <div className="rounded-xl border border-line bg-panel/90 p-5"><h2 className="text-xl font-black">账号、执行器、文案与独立出口</h2><p className="mt-2 text-sm leading-6 text-muted">账号资料、Mac 执行器绑定和 VPN/固定代理策略在独立管理页维护；自动任务会在领取前和写入前两次校验浏览器出口。</p><Link className="focus-ring mt-5 inline-flex h-11 items-center rounded-lg border border-line px-5 font-black" href="/admin/x-accounts">管理 X 账号/IP</Link></div>
        </section>

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-black">自动发送队列与结果</h2><p className="mt-1 text-sm text-muted">勾选多个已就绪草稿可一次批准；Worker 串行发送并在成功任务之间随机等待 3–7 秒。</p></div><div className="flex max-w-full flex-wrap justify-end gap-2"><ApprovalForm mode="batch" readyCount={batchReadyCount} /><Link className="focus-ring rounded-lg border border-line bg-white px-4 py-3 text-sm font-black" href="/admin/x-leads">返回候选列表</Link></div></div>
          <div className="mt-4 space-y-4">
            {cards.map(({ job, preview }) => {
              const preparing = ["pending", "processing"].includes(job.preparation_status);
              const preparationFailed = job.preparation_status === "failed";
              const xResultUrl = job.result_url ?? job.target_post_url;
              const xResultLabel = job.result_url ? "查看已发送回复" : "查看对应原帖";
              return <article className="rounded-xl border border-line bg-panel/90 p-5" key={job.id}>
                <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><span className={cn("rounded-md border px-2.5 py-1 text-xs font-black", X_REPLY_STATUS_STYLES[job.status])}>{X_REPLY_STATUS_LABELS[job.status] ?? job.status}</span><span className="rounded-md border border-line bg-white px-2.5 py-1 text-xs font-black">{X_ACTION_LABELS[job.action_type] ?? job.action_type}</span><strong>{job.x_reply_accounts?.display_name ?? job.account_key_snapshot ?? "未知账号"}</strong><span className="font-mono text-xs text-muted">{job.x_reply_accounts?.account_key ?? job.account_key_snapshot}</span></div><span className="text-xs text-muted"><Clock3 className="mr-1 inline" size={13} />创建 {formatDate(job.created_at)}</span></div>
                {xResultUrl ? <a className="focus-ring mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-black text-accent-ink" href={xResultUrl} rel="noreferrer" target="_blank"><ExternalLink size={16} />{xResultLabel}</a> : null}
                {preparing ? <div className="mt-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-5 text-sm font-bold text-blue-950"><LoaderCircle className="animate-spin" size={20} /><div><p>正在生成单张预览图、专属跳转链接和营销文案</p><p className="mt-1 text-xs font-normal text-blue-800">准备完成前不能批准发送，页面会自动刷新。</p></div></div> : null}
                {preparationFailed ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p className="font-bold">{job.preparation_error ?? "营销素材生成失败。"}</p><form action={retryXAutoPreparation} className="mt-3"><input name="jobId" type="hidden" value={job.id} /><FormSubmitButton className="focus-ring h-9 rounded-md bg-red-700 px-3 text-xs font-black text-white disabled:opacity-50" idleLabel="重新生成" pendingLabel="正在重新入队…" /></form></div> : null}
                {job.preparation_status === "ready" ? <>
                  {job.x_leads ? <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div><p className="mb-2 text-xs font-black text-muted">候选原帖图片</p><div className="aspect-square overflow-hidden rounded-lg border border-line bg-surface"><AdminAsyncImage alt="候选原帖图片" proxyThroughSite src={job.x_leads.media_url} /></div></div>
                    <div><p className="mb-2 text-xs font-black text-muted">自动生成的发送预览</p>{preview ? <div className="aspect-square overflow-hidden rounded-lg border border-line bg-surface"><AdminAsyncImage alt="自动生成的发送预览" src={preview} /></div> : <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">预览链接已失效或暂时不可用，请重新生成后再批准。</div>}</div>
                  </div> : null}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold">{job.status === "draft" ? "原计划发送" : "进入发送队列"}（北京时间）：{formatShanghaiDate(job.scheduled_for)}</p></div>
                  <blockquote className="mt-3 whitespace-pre-wrap rounded-lg border border-line bg-white p-4 text-sm leading-6">{job.reply_text}</blockquote>
                  <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-3"><span>批准：{job.approved_at ? formatDate(job.approved_at) : "—"}</span><span>领取：{job.claimed_at ? formatDate(job.claimed_at) : "—"}</span><span>完成：{job.completed_at ? formatDate(job.completed_at) : "—"}</span></div>
                </> : null}
                {job.status === "draft" && job.preparation_status === "ready" ? <div className="mt-4 flex flex-wrap items-center gap-2"><label className="focus-ring inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-accent bg-white px-3 text-sm font-black text-accent"><input form="batch-approve-form" name="jobId" type="checkbox" value={job.id} />加入本次批量</label><ApprovalForm jobId={job.id} mode="single" /><form action={rejectXAutoDraft}><input name="jobId" type="hidden" value={job.id} /><button className="focus-ring h-10 rounded-lg border border-line px-4 text-sm font-bold" type="submit">拒绝</button></form></div> : null}
                {job.status === "sent" ? <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-900"><CheckCircle2 className="mr-2 inline" size={17} />x-use 已确认本次写操作成功{job.result_url ? <> · <a className="underline" href={job.result_url} rel="noreferrer" target="_blank">打开结果</a></> : null}</p> : null}
                {job.status === "uncertain" ? <p className="mt-4 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm font-bold text-orange-950"><AlertTriangle className="mr-2 inline" size={17} />结果不确定：必须先去 X 查看，系统不会自动重试。</p> : null}
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
