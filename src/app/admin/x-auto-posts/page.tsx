import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, Monitor, Send } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { FormSubmitButton } from "@/components/form-submit-button";
import { QueueAutoRefresh } from "@/components/queue-auto-refresh";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { cn, formatDate, getServerNowMillis } from "@/lib/utils";
import {
  X_ACTION_LABELS,
  X_REPLY_STATUS_LABELS,
  X_REPLY_STATUS_STYLES,
  type XReplyAccount,
  type XReplyJob,
  type XReplyWorker,
} from "@/lib/x-reply";
import {
  approveXAutoDraft,
  createXAutoAccount,
  rejectXAutoDraft,
  retryXAutoPreparation,
  setXAutoAccountActive,
} from "./actions";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  "account-created": "账号定位已保存。下一步需在本机 x-use 导入同名账号会话。",
  "draft-created": "自动发送草稿已创建，尚未批准，也不会发送。",
  "lead-added": "已从候选列表加入自动发送草稿，尚未批准，也不会发送。",
  approved: "已逐条批准；任务将在计划时间由本机执行。",
};

function formatShanghaiDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export default async function XAutoPostsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  await requireAdmin("/admin/x-auto-posts");
  const supabase = getSupabaseServiceClient();
  if (!supabase) return <AppShell admin><main className="mx-auto w-full max-w-3xl px-4 py-10"><SetupWarning /></main></AppShell>;
  const filters = await searchParams;
  const [{ data: accountRows, error: accountsError }, { data: jobRows, error: jobsError }, { data: workerRows }] = await Promise.all([
    supabase.from("x_reply_accounts").select("*").order("created_at", { ascending: true }),
    supabase.from("x_reply_jobs").select("*,x_reply_accounts(account_key,display_name,positioning)").order("created_at", { ascending: false }).limit(100),
    supabase.from("x_reply_workers").select("*").order("last_seen_at", { ascending: false }),
  ]);
  const accounts = (accountRows ?? []) as XReplyAccount[];
  const jobs = (jobRows ?? []) as unknown as XReplyJob[];
  const isPreparing = jobs.some((job) => ["pending", "processing"].includes(job.preparation_status));
  const workers = (workerRows ?? []) as XReplyWorker[];
  const renderedAt = getServerNowMillis();
  const freshWorkers = workers.filter((worker) => renderedAt - new Date(worker.last_seen_at).getTime() < 5 * 60_000);
  const configured = new Set(freshWorkers.flatMap((worker) => worker.configured_accounts));
  const notice = filters.notice ? notices[filters.notice] : null;

  return (
    <AppShell admin>
      <QueueAutoRefresh active={isPreparing} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-accent-strong">x-use 自动链路</p><h1 className="mt-1 text-4xl font-black">X 自动发送</h1><p className="mt-2 text-sm text-muted">每条内容先审核，到了计划时间再由本机 x-use 发送；Cookie 不进入网站或数据库。</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <Link className="focus-ring rounded-lg bg-accent px-4 py-3 text-sm font-black text-accent-ink" href="/admin/x-lead-search">获取待筛选用户</Link>
            <div className={cn("rounded-lg border px-4 py-3 text-sm font-bold", freshWorkers.some((worker) => worker.xuse_available) ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900")}>
              <Monitor className="mr-2 inline" size={17} />{freshWorkers.some((worker) => worker.xuse_available) ? `本机在线 · ${configured.size} 个账号已连接` : "本机 x-use 未连接"}
            </div>
          </div>
        </div>
        {notice ? <p className="mt-5 rounded-lg border border-line bg-panel p-3 text-sm font-bold">{notice}</p> : null}
        {accountsError || jobsError ? <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{accountsError?.message ?? jobsError?.message}</p> : null}
        <p className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950"><strong>发送队列隔离，候选池共用。</strong>候选用户统一由“X 用户筛选”获取；进入自动队列后才调用 x-use，且每条帖子或回复仍需逐条批准。</p>

        <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
          <form action={createXAutoAccount} className="rounded-xl border border-line bg-panel/90 p-5">
            <h2 className="text-xl font-black">账号定位</h2>
            <p className="mt-1 text-xs text-muted">账号标识必须与本机 x-use 的 account_id 完全一致；手动页共用这些定位。</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="x-use 账号标识" name="accountKey" placeholder="pet_new_home" required />
              <Field label="后台显示名" name="displayName" placeholder="新宠到家号" required />
              <Area label="账号定位" name="positioning" placeholder="专注记录新领养宠物与到家纪念" required />
              <Area label="目标受众" name="audience" placeholder="美国新领养狗或猫的主人" required />
              <Area label="表达语气" name="voice" placeholder="温暖、具体、不强推销" required />
              <Area label="禁止话题" name="prohibitedTopics" placeholder="医疗建议、争议事件、未成年人" />
              <Field label="常用话题（逗号分隔）" name="topics" placeholder="new adoption, gotcha day" />
              <Field label="每日批准上限" name="dailyLimit" type="number" defaultValue="5" min="1" max="20" required />
            </div>
            <FormSubmitButton className="focus-ring mt-4 h-11 w-full rounded-lg bg-accent px-4 font-black text-accent-ink disabled:opacity-50" idleLabel="保存账号定位" />
          </form>

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
            <h2 className="text-xl font-black text-blue-950">自动任务从候选列表创建</h2>
            <p className="mt-2 text-sm leading-6 text-blue-900">先查看用户、原帖图片、位置证据和评分，再逐条选择账号、文案与计划时间。这里仅保留账号管理以及发送结果。</p>
            <Link className="focus-ring mt-5 inline-flex h-11 items-center rounded-lg bg-accent px-5 font-black text-accent-ink" href="/admin/x-leads">打开待处理用户与帖子</Link>
          </div>
        </section>

        <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {accounts.map((account) => <article className="rounded-lg border border-line bg-panel/90 p-4" key={account.id}><div className="flex items-start justify-between gap-3"><div><h3 className="font-black">{account.display_name}</h3><p className="font-mono text-xs text-muted">{account.account_key}</p></div><span className={cn("rounded-md border px-2 py-1 text-xs font-bold", configured.has(account.account_key) ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900")}>{configured.has(account.account_key) ? "本机已连接" : "未连接"}</span></div><p className="mt-3 text-sm leading-6">{account.positioning}</p><p className="mt-2 text-xs text-muted">受众：{account.audience}<br />语气：{account.voice}<br />每日上限：{account.daily_limit}</p><form action={setXAutoAccountActive} className="mt-3"><input name="accountId" type="hidden" value={account.id} /><input name="active" type="hidden" value={String(!account.active)} /><button className="focus-ring rounded-md border border-line px-3 py-2 text-xs font-bold" type="submit">{account.active ? "暂停账号" : "恢复账号"}</button></form></article>)}
          {!accounts.length ? <p className="rounded-lg border border-dashed border-line p-6 text-sm text-muted">尚未建立账号定位。</p> : null}
        </section>

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-black">自动发送队列与结果</h2><p className="mt-1 text-sm text-muted">候选任务到这里后仍需逐条批准，批准前不会调用 x-use。</p></div><Link className="focus-ring rounded-lg bg-accent px-4 py-3 text-sm font-black text-accent-ink" href="/admin/x-leads">返回候选列表</Link></div>
          <div className="mt-4 space-y-4">
            {jobs.map((job) => {
              const preparing = ["pending", "processing"].includes(job.preparation_status);
              const preparationFailed = job.preparation_status === "failed";
              return <article className="rounded-xl border border-line bg-panel/90 p-5" key={job.id}>
                <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><span className={cn("rounded-md border px-2.5 py-1 text-xs font-black", X_REPLY_STATUS_STYLES[job.status])}>{X_REPLY_STATUS_LABELS[job.status] ?? job.status}</span><span className="rounded-md border border-line bg-white px-2.5 py-1 text-xs font-black">{X_ACTION_LABELS[job.action_type] ?? job.action_type}</span><strong>{job.x_reply_accounts?.display_name ?? job.account_key_snapshot ?? "未知账号"}</strong><span className="font-mono text-xs text-muted">{job.x_reply_accounts?.account_key ?? job.account_key_snapshot}</span></div><span className="text-xs text-muted"><Clock3 className="mr-1 inline" size={13} />创建 {formatDate(job.created_at)}</span></div>
                {preparing ? <div className="mt-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-5 text-sm font-bold text-blue-950"><LoaderCircle className="animate-spin" size={20} /><div><p>正在生成单张预览图、专属跳转链接和营销文案</p><p className="mt-1 text-xs font-normal text-blue-800">准备完成前不能批准发送，页面会自动刷新。</p></div></div> : null}
                {preparationFailed ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p className="font-bold">{job.preparation_error ?? "营销素材生成失败。"}</p><form action={retryXAutoPreparation} className="mt-3"><input name="jobId" type="hidden" value={job.id} /><FormSubmitButton className="focus-ring h-9 rounded-md bg-red-700 px-3 text-xs font-black text-white disabled:opacity-50" idleLabel="重新生成" pendingLabel="正在重新入队…" /></form></div> : null}
                {job.preparation_status === "ready" ? <><p className="mt-4 text-sm font-bold">计划发送（北京时间）：{formatShanghaiDate(job.scheduled_for)}</p>{job.target_post_url ? <a className="mt-2 inline-block break-all text-sm font-bold text-accent" href={job.target_post_url} rel="noreferrer" target="_blank">查看目标帖子 ↗</a> : null}<blockquote className="mt-3 rounded-lg border border-line bg-white p-4 text-sm leading-6">{job.reply_text}</blockquote><div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-3"><span>批准：{job.approved_at ? formatDate(job.approved_at) : "—"}</span><span>领取：{job.claimed_at ? formatDate(job.claimed_at) : "—"}</span><span>完成：{job.completed_at ? formatDate(job.completed_at) : "—"}</span></div></> : null}
                {job.status === "draft" && job.preparation_status === "ready" ? <div className="mt-4 flex flex-wrap gap-2"><form action={approveXAutoDraft}><input name="jobId" type="hidden" value={job.id} /><FormSubmitButton className="focus-ring h-10 rounded-lg bg-accent px-4 text-sm font-black text-accent-ink disabled:opacity-50" idleLabel="批准并等待到时发送" pendingLabel="正在检查本机账号…" /></form><form action={rejectXAutoDraft}><input name="jobId" type="hidden" value={job.id} /><button className="focus-ring h-10 rounded-lg border border-line px-4 text-sm font-bold" type="submit">拒绝</button></form></div> : null}
                {job.status === "sent" ? <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-900"><CheckCircle2 className="mr-2 inline" size={17} />x-use 已观察到发送成功{job.result_url ? <> · <a className="underline" href={job.result_url} rel="noreferrer" target="_blank">打开结果</a></> : null}</p> : null}
                {job.status === "uncertain" ? <p className="mt-4 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm font-bold text-orange-950"><AlertTriangle className="mr-2 inline" size={17} />结果不确定：必须先去 X 查看，系统不会自动重试。</p> : null}
                {job.error_message ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{job.error_code ? `${job.error_code}: ` : ""}{job.error_message}</p> : null}
                {job.worker_id ? <p className="mt-3 text-xs text-muted"><Send className="mr-1 inline" size={13} />执行器：{job.worker_id}{job.xuse_draft_id ? ` · x-use draft ${job.xuse_draft_id}` : ""}</p> : null}
              </article>;
            })}
            {!jobs.length ? <p className="rounded-xl border border-dashed border-line p-10 text-center text-muted">尚无自动发送记录。</p> : null}
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function Field({ label, name, ...props }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) { return <label className="mt-3 block text-sm font-bold">{label}<input className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" name={name} {...props} /></label>; }
function Area({ label, name, ...props }: { label: string; name: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <label className="block text-sm font-bold">{label}<textarea className="focus-ring mt-2 min-h-24 w-full rounded-lg border border-line bg-white p-3" maxLength={500} name={name} {...props} /></label>; }
