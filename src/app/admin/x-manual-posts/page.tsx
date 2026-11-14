import { CheckCircle2, Hand, LoaderCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { AdminAsyncImage } from "@/components/admin-async-image";
import { AdminListPagination } from "@/components/admin-list-pagination";
import { AppShell } from "@/components/app-shell";
import { CopyImageButton } from "@/components/copy-image-button";
import { CopyButton } from "@/components/copy-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { QueueAutoRefresh } from "@/components/queue-auto-refresh";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { getMarketingReplyPreviewUrl } from "@/lib/marketing";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { cn, formatDate } from "@/lib/utils";
import { sortXManualPosts, X_ACTION_LABELS, X_MANUAL_STATUS_LABELS, type XManualPost } from "@/lib/x-reply";
import { discardXManualDraft, requestLatteManualPostWindow, retryXManualPreparation } from "./actions";
import { MarkSentForm } from "./mark-sent-form";

export const dynamic = "force-dynamic";

const X_MANUAL_POSTS_PAGE_SIZE = 20;

const notices: Record<string, string> = {
  "draft-created": "手动草稿已保存。系统不会自动发送。",
  "lead-added": "已从候选列表加入手动发送队列。系统不会自动发送。",
  "marked-sent": "发送结果已由你手动登记。",
  discarded: "当前手动发送条已作废。",
  "latte-window-requested": "已通知 Mac 使用 Latte 账号和绑定 IP 打开独立发送窗口。",
  "latte-window-active": "Latte 绑定发送窗口已经在打开中。",
};

const statusStyles: Record<string, string> = {
  draft: "border-amber-200 bg-amber-50 text-amber-900",
  sent: "border-emerald-200 bg-emerald-50 text-emerald-900",
  discarded: "border-line bg-surface text-muted",
};

export default async function XManualPostsPage({ searchParams }: { searchParams: Promise<{ notice?: string; page?: string }> }) {
  await requireAdmin("/admin/x-manual-posts");
  const supabase = getSupabaseServiceClient();
  if (!supabase) return <AppShell admin><main className="mx-auto w-full max-w-3xl px-4 py-10"><SetupWarning /></main></AppShell>;
  const filters = await searchParams;
  const postSelect = "*,x_leads(media_url,pet_type,marketing_links!x_leads_marketing_link_id_fkey(source_hash,expires_at))";
  const [{ data: activeRows, error: activeError }, { data: historyRows, error: historyError }] = await Promise.all([
    supabase.from("x_manual_posts").select(postSelect).eq("status", "draft").order("created_at", { ascending: false }).limit(500),
    supabase.from("x_manual_posts").select(postSelect).in("status", ["sent", "discarded"]).order("created_at", { ascending: false }).limit(2000),
  ]);
  const postsError = activeError ?? historyError;
  const allPosts = sortXManualPosts([...(activeRows ?? []), ...(historyRows ?? [])] as unknown as XManualPost[]);
  const requestedPage = Number.parseInt(filters.page ?? "1", 10);
  const totalPages = Math.max(1, Math.ceil(allPosts.length / X_MANUAL_POSTS_PAGE_SIZE));
  const currentPage = Math.min(Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1, totalPages);
  const posts = allPosts.slice((currentPage - 1) * X_MANUAL_POSTS_PAGE_SIZE, currentPage * X_MANUAL_POSTS_PAGE_SIZE);
  const sentCount = allPosts.filter((post) => post.status === "sent").length;
  const cards = await Promise.all(posts.map(async (post) => {
    const link = post.x_leads?.marketing_links;
    const preview = post.status !== "discarded" && post.preparation_status === "ready" && link
      ? await getMarketingReplyPreviewUrl(link.source_hash, link.expires_at)
      : null;
    return { post, preview: preview?.url ?? null };
  }));
  const isPreparing = allPosts.some((post) => post.status !== "discarded" && (["pending", "processing"].includes(post.preparation_status) || ["pending", "processing"].includes(post.preview_download_status)));
  const isOpeningWindow = allPosts.some((post) => ["pending", "running"].includes(post.bound_open_status));
  const notice = filters.notice ? notices[filters.notice] : null;

  return (
    <AppShell admin>
      <QueueAutoRefresh active={isPreparing || isOpeningWindow} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-accent-strong">人工发送链路</p><h1 className="mt-1 text-4xl font-black">X 手动发送</h1><p className="mt-2 text-sm text-muted">保存文案、复制内容，并用 Latte 的绑定 IP 打开独立浏览器；最终发送仍由你手动完成。</p></div>
          <div className="flex flex-wrap gap-2">
            <Link className="focus-ring rounded-lg bg-accent px-4 py-3 text-sm font-black text-accent-ink" href="/admin/x-lead-search">获取待筛选用户</Link>
            <Link className="focus-ring rounded-lg border border-line bg-white px-4 py-3 text-sm font-black" href="/admin/x-auto-posts">管理共用账号定位</Link>
          </div>
        </div>
        {notice ? <p className="mt-5 rounded-lg border border-line bg-panel p-3 text-sm font-bold">{notice}</p> : null}
        {postsError ? <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{postsError.message}</p> : null}
        <p className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950"><strong>发送队列隔离，候选池共用：</strong>手动草稿写入独立数据表，本机发送执行器不会读取；候选用户统一由“X 用户筛选”获取，和自动发送使用同一份待筛选结果。</p>

        <section className="mt-6">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-black">手动发送队列与结果</h2><p className="mt-1 text-sm text-muted">待发送 {allPosts.filter((post) => post.status === "draft").length} 条 · 历史已发送 {sentCount} 条。历史记录会独立完整加载，不再被新任务挤出。</p></div><Link className="focus-ring rounded-lg bg-accent px-4 py-3 text-sm font-black text-accent-ink" href="/admin/x-leads?conclusion=contacted">查看全部已进入发送流程</Link></div>
            <div className="mt-4">
              <AdminListPagination basePath="/admin/x-manual-posts" currentPage={currentPage} pageSize={X_MANUAL_POSTS_PAGE_SIZE} totalItems={allPosts.length} totalPages={totalPages} />
            </div>
            <div className="mt-4 space-y-4">
              {cards.map(({ post, preview }) => {
                const latteWindowActive = ["pending", "running"].includes(post.bound_open_status);
                if (post.status === "discarded") {
                  return <article className="rounded-xl border border-line bg-surface p-5 text-muted" key={post.id}>
                    <div className="flex flex-wrap items-center justify-between gap-3"><span className="rounded-md border border-line bg-white px-2.5 py-1 text-xs font-black">已作废</span><span className="text-xs">{formatDate(post.created_at)}</span></div>
                    <p className="mt-3 text-sm"><Hand className="mr-2 inline" size={16} />这条发送任务已作废，不会继续下载或进入人工发送流程。</p>
                  </article>;
                }
                if (post.preparation_status !== "ready") {
                  const failed = post.preparation_status === "failed";
                  return <article className="rounded-xl border border-line bg-panel/90 p-5" key={post.id}>
                    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><span className={cn("rounded-md border px-2.5 py-1 text-xs font-black", failed ? "border-red-200 bg-red-50 text-red-900" : "border-blue-200 bg-blue-50 text-blue-900")}>{failed ? "素材生成失败" : "素材准备中"}</span><strong>手动发送（Latte + 绑定 IP）</strong></div><span className="text-xs text-muted">{formatDate(post.created_at)}</span></div>
                    {failed ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p className="font-bold">{post.preparation_error ?? "预览图、链接或文案生成失败。"}</p><form action={retryXManualPreparation} className="mt-3"><input name="id" type="hidden" value={post.id} /><FormSubmitButton className="focus-ring inline-flex h-9 items-center rounded-md bg-red-700 px-3 text-xs font-black text-white disabled:opacity-50" idleLabel="重新生成" pendingLabel="正在重新入队…" /></form></div> : <div className="mt-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-5 text-sm font-bold text-blue-950"><LoaderCircle className="animate-spin" size={20} /><div><p>正在生成单张预览图、专属跳转链接和营销文案</p><p className="mt-1 text-xs font-normal text-blue-800">页面会自动刷新；准备完成前不会展示或允许复制半成品。</p></div></div>}
                    <form action={discardXManualDraft} className="mt-3"><input name="id" type="hidden" value={post.id} /><FormSubmitButton className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-line bg-white px-3 text-xs font-bold disabled:opacity-50" idleLabel="作废当前发送条" pendingLabel="正在作废…" /></form>
                  </article>;
                }
                return <article className="rounded-xl border border-line bg-panel/90 p-5" key={post.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><span className={cn("rounded-md border px-2.5 py-1 text-xs font-black", statusStyles[post.status])}>{X_MANUAL_STATUS_LABELS[post.status] ?? post.status}</span><span className="rounded-md border border-line bg-white px-2.5 py-1 text-xs font-black">{X_ACTION_LABELS[post.action_type]}</span><strong>手动发送（Latte + 绑定 IP）</strong></div><span className="text-xs text-muted">{formatDate(post.created_at)}</span></div>
                  {post.x_leads ? <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <figure className="overflow-hidden rounded-lg border border-line bg-white"><div className="aspect-square overflow-hidden bg-surface"><AdminAsyncImage alt="原帖宠物图片" proxyThroughSite src={post.x_leads.media_url} /></div><figcaption className="p-3 text-xs font-black">原帖宠物图 · {post.x_leads.pet_type === "cat" ? "猫" : "狗"}</figcaption></figure>
                    {preview ? <figure className="overflow-hidden rounded-lg border border-emerald-200 bg-white"><div className="aspect-square overflow-hidden bg-surface"><AdminAsyncImage alt="生成的抱枕预览图" src={preview} /></div><figcaption className="p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-black">待发送预览图</span><CopyImageButton status={post.preview_download_status} taskId={post.id} /></div>{post.preview_download_status === "completed" && post.preview_download_path ? <p className="mt-2 break-all text-[11px] text-emerald-800">已保存：{post.preview_download_path}</p> : null}{post.preview_download_status === "failed" ? <p className="mt-2 text-[11px] text-red-700">{post.preview_download_error ?? "本机下载失败，请确认 X worker 正在运行。"}</p> : null}</figcaption></figure> : <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-red-300 bg-red-50 p-5 text-center text-sm font-bold text-red-900"><RotateCcw className="mr-2" size={18} />素材记录已完成，但预览图暂不可读取。</div>}
                  </div> : <p className="mt-4 rounded-lg border border-dashed border-line bg-surface p-3 text-xs text-muted">这是改版前创建的旧任务，没有关联宠物原图和预览图。</p>}
                  {post.target_post_url ? <p className="mt-3 break-all text-xs text-muted">目标帖子只能通过下方 Latte 绑定 IP 入口打开。</p> : null}
                  <blockquote className="mt-3 whitespace-pre-wrap rounded-lg border border-line bg-white p-4 text-sm leading-6">{post.post_text}</blockquote>
                  <div className="mt-3 flex flex-wrap gap-2"><CopyButton emphasized label="复制文案" value={post.post_text} />{post.target_post_url ? <CopyButton label="复制目标链接" value={post.target_post_url} /> : null}{["draft", "sent"].includes(post.status) ? <form action={requestLatteManualPostWindow}><input name="id" type="hidden" value={post.id} /><FormSubmitButton className="focus-ring inline-flex h-9 items-center gap-1 rounded-md bg-accent px-3 text-xs font-black text-accent-ink disabled:opacity-50" disabled={latteWindowActive} idleLabel={latteWindowActive ? "Latte 窗口打开中…" : post.status === "sent" ? "使用 Latte 绑定 IP 查看" : "使用 Latte 绑定 IP 打开目标"} pendingLabel="正在通知 Mac…" /></form> : null}{post.status === "draft" ? <MarkSentForm taskId={post.id} /> : null}</div>
                  {post.bound_open_error ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-800">Latte 绑定窗口打开失败：{post.bound_open_error}</p> : null}
                  {post.status === "sent" ? <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-900"><CheckCircle2 className="mr-2 inline" size={17} />人工登记于 {post.sent_at ? formatDate(post.sent_at) : "—"}；查看 X 结果请使用上方 Latte 绑定 IP 入口。</p> : null}
                </article>;
              })}
              {!cards.length ? <p className="rounded-xl border border-dashed border-line p-10 text-center text-muted">尚无手动发送记录。</p> : null}
            </div>
            <div className="mt-4">
              <AdminListPagination basePath="/admin/x-manual-posts" currentPage={currentPage} pageSize={X_MANUAL_POSTS_PAGE_SIZE} totalItems={allPosts.length} totalPages={totalPages} />
            </div>
        </section>
      </main>
    </AppShell>
  );
}
