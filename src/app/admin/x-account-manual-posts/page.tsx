import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-field";
import { AdminAsyncImage } from "@/components/admin-async-image";
import { requireAdmin } from "@/lib/auth";
import { ACCOUNT_MANUAL_PATH, type AccountManualPost, freshManualHelper, MANUAL_HELPER_ID, MANUAL_SENDER_LABEL } from "@/lib/x-account-manual";
import { loadManualRoute, manualDb } from "@/lib/x-account-manual-server";
import { signAccountDesignAsset } from "@/lib/x-account-design-assets";
import { validateV2Snapshot } from "@/lib/x-reply-v2";
import { ManualIpConfirmation, ManualReport, ManualWindowControl } from "./controls";

export const dynamic = "force-dynamic";

export default async function AccountManualPage() {
  await requireAdmin(ACCOUNT_MANUAL_PATH);
  const db = manualDb();
  const [{ data: rows, error }, { data: history, error: historyError }, { data: helper }, { data: requests, error: requestError }] = await Promise.all([
    db.from("x_account_manual_posts").select("*").order("created_at", { ascending: true }).limit(500),
    db.from("x_reply_jobs").select("id,account_id,target_author_id,source_post_id,reply_text,status,result_url,error_message,account_preview_path,x_reply_accounts(display_name,account_key)")
      .eq("queue_version", 2).order("created_at", { ascending: false }).limit(500),
    db.from("x_account_manual_helpers").select("*").eq("helper_id", MANUAL_HELPER_ID).maybeSingle(),
    db.from("x_account_manual_open_requests").select("id,task_id,boot_id,route_revision,status,message,session_id,expected_ip,user_confirmed_at,created_at")
      .order("created_at", { ascending: false }).limit(100),
  ]);
  if (error || historyError || requestError) throw new Error(error?.message ?? historyError?.message ?? requestError?.message);
  const posts = (rows ?? []) as AccountManualPost[];
  const migrated = new Set(posts.flatMap((p) => p.source_v2_job_id ? [p.source_v2_job_id] : []));
  const retainedHistory = (history ?? []).filter((j) => !migrated.has(j.id));
  const authorIds = [...new Set([...posts.map((p) => p.target_author_id), ...retainedHistory.map((j) => j.target_author_id).filter(Boolean)])];
  const { data: handles } = authorIds.length ? await db.from("x_lead_account_reviews").select("author_id,x_handle").in("author_id", authorIds) : { data: [] };
  const handleMap = new Map((handles ?? []).map((r) => [r.author_id, r.x_handle]));
  let route: Awaited<ReturnType<typeof loadManualRoute>> | null = null, routeError = "";
  try { route = await loadManualRoute(); } catch (e) { routeError = e instanceof Error ? e.message : "绑定不可读"; }
  const online = freshManualHelper(helper);
  const currentRequests = (requests ?? []).filter((r) => online && r.boot_id === helper?.boot_id && r.route_revision === route?.revision && r.expected_ip === route?.expectedIp);
  const sessionOpen = helper?.session_state === "open" && helper.route_revision === route?.revision && helper.expected_ip === route?.expectedIp;
  const confirmation = currentRequests.find((r) => sessionOpen && r.status === "ip_confirmed" && r.session_id === helper?.session_id && r.user_confirmed_at);
  const opened = currentRequests.find((r) => sessionOpen && r.status === "opened_manual_check" && r.session_id === helper?.session_id);
  const cards = await Promise.all(posts.map(async (post) => ({ post,
    block: post.status === "draft" ? await validateV2Snapshot(db, post.snapshot) : null,
    image: post.snapshot.account_preview_path ? await signAccountDesignAsset(post.snapshot.account_preview_path, 900) : null })));
  return <AppShell admin><main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-8">
    <div><h1 className="text-3xl font-black">账号手动发送队列</h1><p className="mt-2">固定发送账号：<strong>{MANUAL_SENDER_LABEL}</strong></p>
      <p className="mt-1 text-sm text-muted">复制文案与预览图，由本人在绑定窗口逐条操作 X；本页不会批准自动任务或点击发布。</p>
      <Link href="/admin/x-account-candidates" className="mt-2 inline-block text-accent underline">账号候选与证据</Link></div>
    <section className="rounded-xl border border-line bg-panel p-4 text-sm leading-6">
      <h2 className="font-black">独立手动窗口与 IP 核对</h2>
      <p>{online ? "手动助手在线；不代表 X 登录或账号状态已就绪。" : "独立手动助手未在线。请先手动启动助手；离线时不创建待开窗口请求。"}</p>
      <p>预期固定出口：{route?.expectedIp ?? "不可读"}。{routeError}</p>
      <p>首次只打开 IP 核对页。本人核对后，复制目标链接，切回该独立绑定 Chrome 窗口，在同一标签地址栏粘贴；首次登录、账号核对、上传图片和发送均由本人完成。后续目标也复用此标签，不另开通用浏览器。</p>
      <p>发送登记、复制或下载不会关闭窗口。助手不自动保存或复制 Cookie，不自动控制 X 页面；浏览器页面自身仍可能产生后台网络请求。遇验证、限制或账号不符时停止人工发送并保留现场。</p>
      {confirmation ? <p className="font-bold text-emerald-800">已登记用户声明 IP 已核对（当前助手会话）。仍须本人在 X 自行核对登录账号为 @Le6wCummeratawi。</p> : opened ? <><p>已有按绑定配置打开的窗口，请本人核对；系统未自动验证出口或账号。</p><ManualIpConfirmation requestId={opened.id} /></> : null}
      {currentRequests[0] ? <p className="text-xs text-muted">最近开窗状态：{currentRequests[0].status} · {currentRequests[0].message}</p> : null}
    </section>
    <section><h2 className="text-xl font-black">人工待发送与本人登记 · {posts.length}</h2><p className="text-sm text-muted">待发送 {posts.filter((p) => p.status === "draft").length}；本人登记已发送 {posts.filter((p) => p.status === "reported").length}。图片和链接保留原审阅快照；失效时阻断，不静默替换。</p>
      <div className="mt-3 space-y-4">{cards.map(({ post, image, block }) => <article className="rounded-xl border border-line bg-panel p-4" id={`v2-job-${post.source_v2_job_id ?? post.id}`} key={post.id}>
        <span id={`manual-job-${post.id}`} /><h3 className="font-black">@{post.target_handle} · {post.status === "reported" ? "本人登记已发送（未自动核验）" : "人工待发送"}</h3>
        <p className="text-xs text-muted">手动任务 {post.id} · {MANUAL_SENDER_LABEL}{post.source_v2_job_id ? ` · 原 V2 ${post.source_v2_job_id}（来源 Latte，已退出自动执行）` : ""}</p>
        <p className="mt-2 text-sm">{post.snapshot.product_match_reason_snapshot}</p>
        <blockquote className="my-3 whitespace-pre-wrap rounded border border-line bg-white p-3 text-sm">{post.reply_text}</blockquote>
        {image ? <figure className="mb-3 max-w-sm"><AdminAsyncImage alt="该任务原审阅商品预览图" src={image} /><figcaption className="text-xs text-muted">原审阅预览图 · SHA256 {post.snapshot.account_preview_hash}</figcaption></figure> : <p className="text-sm">此条是明确选择的纯文字草稿，没有附件。</p>}
        <p className="mb-2 text-xs text-muted">复制文案不会附图；图文任务请在 X 手动上传下载的商品预览图。PNG 为原 WebP 快照的下载派生文件，原快照及哈希不变。</p><div className="flex flex-wrap gap-2"><CopyButton label="复制文案" value={post.reply_text} />{image ? <a className="rounded border border-line px-3 py-2 text-sm" href={`/api/x-account-manual/posts/${post.id}/preview`}>下载商品预览图</a> : null}
          {confirmation && !block && post.status === "draft" ? <CopyButton emphasized label="复制目标链接，回绑定标签粘贴" value={post.target_post_url} /> : null}</div>
        {post.status === "draft" ? block ? <p className="mt-2 text-red-800">已阻断：{block}。不能打开目标或自动重生成。</p> : <><ManualWindowControl taskId={post.id} helperOnline={online && Boolean(route)} /><ManualReport taskId={post.id} withPreview={post.snapshot.content_mode === "account_product_preview"} /></> : <p className="mt-2 text-sm">人工登记时间 {post.reported_at}；结果 {post.result_url ? <CopyButton label="复制本人登记结果链接" value={post.result_url} /> : "—"}。系统未访问 X 核验。</p>}
      </article>)}</div>
    </section>
    <section><h2 className="text-xl font-black">原 V2 历史与未迁移记录 · {retainedHistory.length}</h2><p className="text-sm text-muted">保留原发送账号。已发送或结果未决的记录不可转成其他账号重发，也没有重试入口。</p>
      <div className="mt-3 space-y-3">{retainedHistory.map((job) => {
        const sender = Array.isArray(job.x_reply_accounts) ? job.x_reply_accounts[0] : job.x_reply_accounts;
        return <article className="rounded border border-line p-4 text-sm" key={job.id} id={`v2-job-${job.id}`}><h3 className="font-black">@{handleMap.get(job.target_author_id ?? "") ?? job.target_author_id} · {job.status === "sent" ? "原账号已发送" : job.status === "uncertain" ? "结果待核对，禁止重试或换号重发" : `原 V2 ${job.status}（只读）`}</h3>
          <p>原发送账号 {sender?.display_name} / @{sender?.account_key} · 任务 {job.id}</p><blockquote className="my-2 whitespace-pre-wrap">{job.reply_text}</blockquote>{job.error_message ? <p className="text-red-800">{job.error_message}</p> : null}{job.result_url ? <CopyButton label="复制原结果链接" value={job.result_url} /> : null}</article>;
      })}</div>
    </section>
  </main></AppShell>;
}
