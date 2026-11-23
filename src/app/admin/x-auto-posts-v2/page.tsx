import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { X_REPLY_STATUS_LABELS } from "@/lib/x-reply";
import { supportsXReplyV2Worker } from "@/lib/x-reply-v2";
import { getServerNowMillis } from "@/lib/utils";
import { IdleAutoRefresh } from "@/components/idle-auto-refresh";
import { withdrawV2Draft } from "./actions";
import { V2BatchControls } from "./v2-controls";

export const dynamic = "force-dynamic";

export default async function XAutoV2Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin("/admin/x-auto-posts-v2");
  const filters = await searchParams;
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const [{ data: drafts, error: draftError }, { data: jobs, error: jobError }, { data: accounts, error: accountError }, { data: workers }] = await Promise.all([
    supabase.from("x_lead_account_drafts").select("author_id,status,review_status,selected_post_id,product_slug,reply_text,marketing_expires_at,x_lead_account_reviews!inner(x_handle,account_status,entry_status,review_status)")
      .eq("status", "draft_ready").eq("review_status", "unreviewed").order("generated_at", { ascending: false }).limit(200),
    supabase.from("x_reply_jobs").select("id,account_id,target_author_id,source_post_id,reply_text,status,preparation_status,preparation_error,approved_at,created_at,completed_at,result_url,error_message,marketing_link_id,product_slug_snapshot,product_match_reason_snapshot,x_reply_accounts(account_key,display_name)")
      .eq("queue_version", 2).order("created_at", { ascending: false }).limit(500),
    supabase.from("x_reply_accounts").select("id,account_key,display_name,active,executor_id").eq("active", true).order("display_name"),
    supabase.from("x_reply_workers").select("executor_id,worker_version,execution_mode,last_seen_at"),
  ]);
  if (draftError || jobError || accountError) throw new Error(draftError?.message ?? jobError?.message ?? accountError?.message);
  const allJobs = jobs ?? [];
  const statuses = ["draft", "queued", "claimed", "sent", "failed", "uncertain", "rejected"];
  const shownJobs = filters.status && statuses.includes(filters.status) ? allJobs.filter((job) => job.status === filters.status) : allJobs;
  const nowMillis = getServerNowMillis();
  const activeAuthors = new Set(allJobs.filter((job) => ["draft", "queued", "claimed", "sent", "uncertain"].includes(job.status))
    .map((job) => job.target_author_id));
  const senderList = (accounts ?? []).map((account) => ({ id: account.id, label: `${account.display_name} (${account.account_key})` }));
  const workerByExecutor = new Map((workers ?? []).map((worker) => [worker.executor_id, worker]));
  const candidates = (drafts ?? []).filter((draft) => !activeAuthors.has(draft.author_id)
    && Date.parse(String(draft.marketing_expires_at ?? "")) > nowMillis + 24 * 60 * 60_000)
    .flatMap((draft) => {
      const review = Array.isArray(draft.x_lead_account_reviews) ? draft.x_lead_account_reviews[0] : draft.x_lead_account_reviews;
      if (!review || review.review_status === "dismissed" || review.account_status === "excluded" || review.entry_status === "hold") return [];
      return [{ id: draft.author_id, label: `@${review.x_handle ?? draft.author_id}`,
        detail: `${draft.product_slug} · 本人帖 ${draft.selected_post_id} · 需服务端复核` }];
    });
  const authorIds = [...new Set(allJobs.flatMap((job) => job.target_author_id ? [job.target_author_id] : []))];
  const { data: reviews } = authorIds.length ? await supabase.from("x_lead_account_reviews")
    .select("author_id,x_handle").in("author_id", authorIds) : { data: [] };
  const handles = new Map((reviews ?? []).map((review) => [review.author_id, review.x_handle]));
  const senderName = (job: (typeof allJobs)[number]) => {
    const relation = Array.isArray(job.x_reply_accounts) ? job.x_reply_accounts[0] : job.x_reply_accounts;
    return relation?.display_name ?? "发送账号";
  };
  const pending = allJobs.filter((job) => job.status === "draft").map((job) => ({ id: job.id,
    label: `@${handles.get(job.target_author_id ?? "") ?? job.target_author_id}`, detail: `${job.product_slug_snapshot ?? "商品待核"} · 本人帖 ${job.source_post_id} · ${senderName(job)}` }));
  return <AppShell admin><main className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 py-8 sm:px-6">
    <IdleAutoRefresh idleMs={30_000} />
    <div><p className="text-xs font-black uppercase tracking-widest text-accent-strong">Account-first public replies</p>
      <h1 className="mt-1 text-3xl font-black">自动队列 V2</h1>
      <p className="mt-2 text-sm text-muted">选择账号草稿，回复其近期原帖并介绍相关在售商品。加入后先待审；人工批准才会启动发送。</p>
      <div className="mt-3 flex gap-4 text-sm"><Link className="text-accent underline" href="/admin/x-leads?mode=account_review">账号候选与证据</Link><Link className="text-accent underline" href="/admin/x-auto-posts">旧版自动队列</Link><Link className="text-accent underline" href="/admin/x-accounts">发送账号与每日配置</Link></div>
    </div>
    <div className="grid gap-4 lg:grid-cols-2"><V2BatchControls kind="add" items={candidates} senders={senderList} /><V2BatchControls kind="approve" items={pending} /></div>
    <section><h2 className="text-xl font-black">V2 任务 · {allJobs.length}</h2>
      <div className="mt-2 flex flex-wrap gap-2 text-sm"><Link className="text-accent underline" href="/admin/x-auto-posts-v2">全部</Link>{statuses.map((status) => <Link className="text-accent underline" key={status} href={`/admin/x-auto-posts-v2?status=${status}`}>{X_REPLY_STATUS_LABELS[status]}</Link>)}</div>
      <div className="mt-3 grid gap-3">{shownJobs.map((job) => {
        const sender = (accounts ?? []).find((account) => account.id === job.account_id);
        const worker = sender?.executor_id ? workerByExecutor.get(sender.executor_id) : null;
        const compatible = Boolean(worker && supportsXReplyV2Worker(worker.worker_version) && worker.execution_mode === "send"
          && nowMillis - Date.parse(worker.last_seen_at) < 5 * 60_000);
        return <article id={`v2-job-${job.id}`} className="scroll-mt-6 rounded-xl border border-line bg-panel p-4 text-sm" key={job.id}>
          <div className="flex flex-wrap items-center gap-2"><strong>{X_REPLY_STATUS_LABELS[job.status] ?? job.status}</strong>
            <span>@{handles.get(job.target_author_id ?? "") ?? job.target_author_id}</span>
            <span className="text-xs text-muted">任务 {job.id}</span><span className="text-xs text-muted">{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(job.created_at))}</span>
            <Link className="text-accent underline" href={`/admin/x-leads?mode=account_review&author=${job.target_author_id}`}>查看账号证据</Link></div>
          <p className="mt-1">发送账号 {sender?.display_name ?? senderName(job)} · 商品 {job.product_slug_snapshot} · 本人帖 <a className="text-accent underline" href={`https://x.com/i/status/${job.source_post_id}`} target="_blank" rel="noreferrer">{job.source_post_id}</a></p>
          {job.product_match_reason_snapshot ? <p className="mt-1 text-xs text-muted">匹配理由：{job.product_match_reason_snapshot}</p> : null}
          <p className="mt-2 whitespace-pre-wrap break-words rounded border border-line bg-surface p-2">{job.reply_text}</p>
          <p className="mt-1 text-xs text-muted">{job.status === "draft" && !compatible ? "待执行器升级至 4.11.0/send；仍可保留待审草稿" : job.status === "draft" ? "待人工批准" : job.status === "queued" ? "已批准，等待执行器与每日安全门槛" : "状态以执行记录为准"}</p>
          {job.result_url ? <a className="text-accent underline" href={job.result_url} target="_blank" rel="noreferrer">发送结果</a> : null}
          {job.preparation_status === "failed" ? <p className="mt-1 text-red-700">已阻断：{job.preparation_error ?? "证据失效"}。请撤回、重生成草稿并重新加入。</p> : null}
          {job.error_message ? <p className="text-red-700">{job.error_message}</p> : null}
          {["draft", "queued"].includes(job.status) ? <form className="mt-2" action={withdrawV2Draft}><input type="hidden" name="jobId" value={job.id} /><button className="rounded border border-line px-3 py-2 font-bold" type="submit">撤回</button></form> : null}
        </article>;
      })}</div>
      {!allJobs.length ? <p className="mt-2 text-sm text-muted">还没有 V2 任务；账号草稿需人工选择后加入待审队列。</p> : null}
    </section>
  </main></AppShell>;
}
