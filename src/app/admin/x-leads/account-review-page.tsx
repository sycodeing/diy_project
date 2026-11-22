import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isTrustedRawPhotoUrl } from "@/lib/x-lead-raw-review";
import { RawPostPhotos } from "./raw-post-photos";
import { setAccountReviewStatus } from "./account-review-actions";
import { generateAccountReplyDraft, setAccountDraftReviewStatus } from "./account-draft-actions";
import { getActiveAccountProducts } from "@/lib/x-lead-account-products";

const PAGE_SIZE = 30;
const ACCOUNT_STATES = ["potential", "watch", "insufficient", "excluded"];
const ENTRY_STATES = ["ready", "no_entry", "context_pending", "hold"];

type Filters = { account?: string; entry?: string; job?: string; status?: string; author?: string; page?: string };
const ACCOUNT_LABELS: Record<string, string> = { potential: "有独立行为证据", watch: "观察", insufficient: "证据不足", excluded: "排除" };
const ENTRY_LABELS: Record<string, string> = { ready: "有交流入口", no_entry: "暂无入口", context_pending: "父帖待核", hold: "暂缓" };
function pageTimeMs() { return Date.now(); }

export async function AccountReviewPage({ filters }: { filters: Filters }) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const page = Math.max(1, Number.parseInt(filters.page ?? "1", 10) || 1);
  let query = supabase.from("x_lead_account_reviews")
    .select("author_id,x_handle,account_status,entry_status,account_evidence,entry_evidence,source_history,latest_source_job_id,latest_source_archive,classifier_version,review_status,first_seen_at,last_seen_at", { count: "exact" })
    .order("last_seen_at", { ascending: false }).order("author_id", { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (filters.account && ACCOUNT_STATES.includes(filters.account)) query = query.eq("account_status", filters.account);
  if (filters.entry && ENTRY_STATES.includes(filters.entry)) query = query.eq("entry_status", filters.entry);
  if (filters.job && /^[0-9a-f-]{36}$/i.test(filters.job)) query = query.eq("latest_source_job_id", filters.job);
  if (filters.author && /^\d{5,30}$/.test(filters.author)) query = query.eq("author_id", filters.author);
  if (["unreviewed", "dismissed"].includes(filters.status ?? "")) query = query.eq("review_status", filters.status!);
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const [{ data: draftData, error: draftError }, { data: queueData, error: queueError }, activeProducts] = await Promise.all([
    rows.length ? supabase.from("x_lead_account_drafts")
      .select("author_id,status,reason,evidence_coverage,selected_post_id,selected_post_created_at,selected_post_excerpt,product_slug,product_match_reason,reply_text,marketing_url,marketing_expires_at,generation_version,generated_at,review_status")
      .in("author_id", rows.map((row) => row.author_id)) : Promise.resolve({ data: [], error: null }),
    rows.length ? supabase.from("x_reply_jobs")
      .select("id,target_author_id,status,created_at").eq("queue_version", 2)
      .in("target_author_id", rows.map((row) => row.author_id)).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    getActiveAccountProducts(),
  ]);
  if (draftError) throw new Error(draftError.message);
  if (queueError) throw new Error(queueError.message);
  const drafts = new Map((draftData ?? []).map((draft) => [draft.author_id, draft]));
  const queueByAuthor = new Map<string, { id: string; status: string }>();
  for (const job of queueData ?? []) if (job.target_author_id && !queueByAuthor.has(job.target_author_id))
    queueByAuthor.set(job.target_author_id, { id: job.id, status: job.status });
  const activeSlugs = new Set(activeProducts.map((product) => product.slug));
  const nowMs = pageTimeMs();
  const pageHref = (next: number) => {
    const params = new URLSearchParams({ mode: "account_review", page: String(next) });
    if (filters.account) params.set("account", filters.account);
    if (filters.entry) params.set("entry", filters.entry);
    if (filters.job) params.set("job", filters.job);
    if (filters.author) params.set("author", filters.author);
    if (filters.status) params.set("status", filters.status);
    return `/admin/x-leads?${params}`;
  };
  const filterHref = (name: "account" | "entry" | "status", value: string) => {
    const params = new URLSearchParams({ mode: "account_review" });
    for (const [key, selected] of Object.entries({ account: filters.account, entry: filters.entry, status: filters.status, job: filters.job })) {
      if (selected && key !== name) params.set(key, selected);
    }
    if (value) params.set(name, value);
    return `/admin/x-leads?${params}`;
  };
  return <AppShell admin><main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-black">按账号审阅 X 参与者</h1><Link className="font-bold text-accent underline" href="/admin/x-lead-search">手动启动账号发现</Link></div>
    <Link className="mt-2 inline-block text-sm font-bold text-accent underline" href="/admin/x-auto-posts-v2">查看自动队列 V2</Link>
    <p className="mt-2 text-sm text-muted">稳定作者 ID 跨任务只显示一张最新评估卡；历史种子、回复与近期本人帖保留来源。账号适配与当前交流入口分开，所有结果均待人工核实，未取得联系资格。</p>
    <div className="mt-4 flex flex-wrap gap-2 text-sm">
      <Link className="rounded-lg border border-line px-3 py-2" href="/admin/x-leads?mode=account_review">全部账号</Link>
      {ACCOUNT_STATES.map((status) => <Link className="rounded-lg border border-line px-3 py-2" key={status} href={filterHref("account", status)}>{ACCOUNT_LABELS[status]}</Link>)}
      {ENTRY_STATES.map((status) => <Link className="rounded-lg border border-line px-3 py-2" key={status} href={filterHref("entry", status)}>{ENTRY_LABELS[status]}</Link>)}
      <Link className="rounded-lg border border-line px-3 py-2" href={filterHref("status", "unreviewed")}>未处理</Link><Link className="rounded-lg border border-line px-3 py-2" href={filterHref("status", "dismissed")}>已忽略</Link>
      <Link className="rounded-lg border border-line px-3 py-2" href="/admin/x-leads?mode=raw_review">原始帖子历史</Link>
    </div>
    <p className="mt-4 text-sm text-muted">{count ?? 0} 个账号。空表表示尚未运行账号模式，历史原始帖子不会自动变成账号证据。</p>
    <div className="mt-5 grid gap-4">{rows.map((row) => {
      const draft = drafts.get(row.author_id);
      const queueJob = queueByAuthor.get(row.author_id);
      const draftFresh = draft?.status === "draft_ready"
        && draft.review_status !== "dismissed"
        && draft.marketing_expires_at && Date.parse(draft.marketing_expires_at) > nowMs
        && draft.product_slug && activeSlugs.has(draft.product_slug as "custom-pillow" | "face-towel")
        && row.review_status !== "dismissed" && row.account_status !== "excluded"
        && !(row.account_evidence && typeof row.account_evidence === "object"
          && !Array.isArray(row.account_evidence) && (row.account_evidence as Record<string, unknown>).exclusion_reason)
        && draft.selected_post_created_at && nowMs - Date.parse(draft.selected_post_created_at) <= 14 * 24 * 60 * 60_000
        && row.entry_status !== "hold";
      const account = (row.account_evidence ?? {}) as Record<string, unknown>;
      const entry = (row.entry_evidence ?? {}) as Record<string, unknown>;
      const person = Array.isArray(account.person_evidence) ? account.person_evidence : [];
      const project = Array.isArray(account.project_evidence) ? account.project_evidence : [];
      const evidence = [...person, ...project] as Array<{ post_id?: string; text?: string; quote?: string; source?: string; created_at?: string; photo_urls?: string[] }>;
      return <article className="rounded-xl border border-line bg-panel p-4" key={row.author_id}>
        <div className="flex flex-wrap items-center gap-3">{row.x_handle ? <a className="font-black text-accent underline" href={`https://x.com/${row.x_handle}`} target="_blank" rel="noreferrer">@{row.x_handle}</a> : <span className="font-bold">账号名待核</span>}<span className="text-xs text-muted">ID {row.author_id}</span><span className="rounded border border-line px-2 py-1 text-xs">账号 {ACCOUNT_LABELS[row.account_status] ?? row.account_status}</span><span className="rounded border border-line px-2 py-1 text-xs">入口 {ENTRY_LABELS[row.entry_status] ?? row.entry_status}</span><span className="text-xs text-muted">人工 {row.review_status === "dismissed" ? "已忽略" : "未处理"}</span></div>
        <p className="mt-2 text-sm">本人宠物证据 {person.length} 条 · 个性化/装饰行为 {project.length} 条 · 购买意向 {String(account.shopping_intent ?? "unknown")} · 商品关联 {String(account.product_fit ?? "unknown")}</p>
        <p className="mt-1 text-xs text-muted">近期本人帖补证：{String(account.timeline_status ?? "pending")}；同类需求已完成：{String(account.same_product_need_resolved ?? false)}。原帖图片只作上下文，未核实归属或商品适配。</p>
        {evidence.map((item) => <div className="mt-2 rounded-lg border border-line p-3 text-sm" key={`${item.post_id}-${item.quote}`}><a className="font-bold text-accent underline" href={`https://x.com/i/status/${item.post_id}`} target="_blank" rel="noreferrer">{item.source === "reply" ? "本人回复" : "近期本人帖"} · {item.post_id}</a><span className="ml-2 text-xs text-muted">{item.created_at || "时间未知"}</span><p className="mt-1 whitespace-pre-wrap break-words">{item.text}</p><p className="mt-1 text-xs text-muted">证据原句：{item.quote}</p>{Array.isArray(item.photo_urls) && item.photo_urls.length ? <RawPostPhotos urls={item.photo_urls.filter(isTrustedRawPhotoUrl).slice(0, 4)} postUrl={`https://x.com/i/status/${item.post_id}`} /> : null}</div>)}
        <div className="mt-3 border-t border-line pt-3 text-sm"><strong>当前交流入口：</strong>{entry.post_id ? <a className="text-accent underline" href={`https://x.com/i/status/${entry.post_id}`} target="_blank" rel="noreferrer">{String(entry.text ?? entry.post_id)}</a> : "尚无适合的新入口"}<p className="mt-1 text-xs text-muted">入口时间 {String(entry.created_at ?? "未知")} · 直接父帖：{String(entry.direct_parent_status ?? "unknown")}；不继承种子作者身份或图片。</p>{Array.isArray(entry.photo_urls) && entry.photo_urls.length ? <RawPostPhotos urls={(entry.photo_urls as string[]).filter(isTrustedRawPhotoUrl).slice(0, 4)} postUrl={`https://x.com/i/status/${entry.post_id}`} /> : null}</div>
        <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-sm">
          {queueJob ? <p className="mb-2"><Link className="font-bold text-accent underline" href="/admin/x-auto-posts-v2">V2 队列：{queueJob.status} · {queueJob.id}</Link></p> : null}
          <div className="flex flex-wrap items-center gap-2"><strong>公开回复草稿：</strong><span>{draft?.status === "draft_ready" ? "待人工审阅" : draft?.status === "no_match" ? "暂无商品匹配" : draft?.status === "evidence_pending" ? "证据待补" : draft?.status === "blocked" ? "已阻断" : "尚未生成"}</span><span className="text-xs text-muted">{draft?.evidence_coverage === "partial" ? "已有证据覆盖不完整" : draft?.evidence_coverage === "full" ? "已存有限本人帖快照" : ""}</span></div>
          {draft ? <p className="mt-1 text-xs text-muted">{draft.reason} · {draft.generation_version} · {draft.generated_at}</p> : null}
          {draft?.selected_post_id ? <p className="mt-2 text-xs">所选本人帖：<a className="text-accent underline" href={`https://x.com/i/status/${draft.selected_post_id}`} target="_blank" rel="noreferrer">{draft.selected_post_id}</a> · {draft.selected_post_created_at}<br />{draft.selected_post_excerpt}</p> : null}
          {draft?.product_match_reason ? <p className="mt-2 text-xs">商品用途判断：{draft.product_match_reason}；选中商品 {draft.product_slug}。原帖图片未验归属，也未生成个人预览。</p> : null}
          {draftFresh ? <div className="mt-2"><p className="whitespace-pre-wrap rounded border border-line bg-panel p-2">{draft.reply_text}</p><a className="mt-1 inline-block text-xs text-accent underline" href={draft.marketing_url!} target="_blank" rel="noreferrer">查看该商品归因链接</a><p className="text-xs text-muted">链接至 {draft.marketing_expires_at}；仅待审草稿，未批准、未入队、未发送。</p></div> : draft?.status === "draft_ready" ? <p className="mt-2 text-xs text-muted">草稿链接已过期、商品不可售或人工已忽略；请重生成并复核。</p> : null}
          <div className="mt-2 flex flex-wrap gap-2"><form action={generateAccountReplyDraft}><input type="hidden" name="authorId" value={row.author_id} /><button className="rounded-lg border border-line px-3 py-2 text-xs font-bold" type="submit">{draft ? "重生成并核实" : "生成待审草稿"}</button></form>{draft ? <form action={setAccountDraftReviewStatus}><input type="hidden" name="authorId" value={row.author_id} /><input type="hidden" name="status" value={draft.review_status === "dismissed" ? "unreviewed" : "dismissed"} /><button className="rounded-lg border border-line px-3 py-2 text-xs font-bold" type="submit">{draft.review_status === "dismissed" ? "恢复草稿待审" : "忽略草稿"}</button></form> : null}</div>
        </div>
        <form action={setAccountReviewStatus} className="mt-3"><input type="hidden" name="authorId" value={row.author_id} /><input type="hidden" name="status" value={row.review_status === "dismissed" ? "unreviewed" : "dismissed"} /><button className="rounded-lg border border-line px-3 py-2 text-xs font-bold" type="submit">{row.review_status === "dismissed" ? "恢复待审" : "忽略此账号"}</button></form>
        <p className="mt-2 text-xs text-muted">最新来源 {row.latest_source_archive} · 分类 {row.classifier_version} · 历史批次 {Array.isArray(row.source_history) ? row.source_history.length : 0}</p>
      </article>;
    })}</div>
    <div className="mt-6 flex gap-4 text-sm">{page > 1 && <Link className="text-accent underline" href={pageHref(page - 1)}>上一页</Link>}{page * PAGE_SIZE < (count ?? 0) && <Link className="text-accent underline" href={pageHref(page + 1)}>下一页</Link>}</div>
  </main></AppShell>;
}
