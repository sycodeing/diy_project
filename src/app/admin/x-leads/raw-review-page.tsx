import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { formatAdminDate } from "@/lib/utils";
import { setRawReviewStatus } from "./raw-review-actions";

type RawFilters = { tier?: string; topic?: string; reply?: string; status?: string;
  stage?: string; parent?: string; field?: string; query?: string; page?: string };
type RawRow = {
  post_id: string; author_id: string; x_handle: string; post_url: string;
  post_text: string; posted_at: string | null; source_archive: string;
  source_stage: string; classifier_version: string; classifier_tier: string;
  exclusion_reasons: string[]; intent: Record<string, unknown>;
  body_topic_match: boolean; is_reply: boolean; parent_post_id: string | null;
  parent_status: string; parent_evidence: string | null; parent_source_archive: string | null;
  review_status: string; first_seen_at: string;
};

export async function RawReviewPage({ filters }: { filters: RawFilters }) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端配置缺失。");
  const requestedPage = Number.parseInt(filters.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1000) : 1;
  const pageSize = 40;
  let query = supabase.from("x_lead_raw_reviews")
    .select("post_id,author_id,x_handle,post_url,post_text,posted_at,source_archive,source_stage,classifier_version,classifier_tier,exclusion_reasons,intent,body_topic_match,is_reply,parent_post_id,parent_status,parent_evidence,parent_source_archive,review_status,first_seen_at", { count: "exact" })
    .order("first_seen_at", { ascending: false }).order("post_id", { ascending: false });
  if (["excluded", "exploratory", "explicit_request"].includes(filters.tier ?? "")) query = query.eq("classifier_tier", filters.tier!);
  if (["true", "false"].includes(filters.topic ?? "")) query = query.eq("body_topic_match", filters.topic === "true");
  if (["true", "false"].includes(filters.reply ?? "")) query = query.eq("is_reply", filters.reply === "true");
  if (["unreviewed", "dismissed"].includes(filters.status ?? "")) query = query.eq("review_status", filters.status!);
  if (["shopping_broad", "buyer_recommend_pillow", "shopping_pet_product", "shopping_pet_broad", "buyer_where_pillow", "shopping_product_only"].includes(filters.stage ?? "")) query = query.eq("source_stage", filters.stage!);
  if (["not_applicable", "unresolved", "resolved_product_mismatch"].includes(filters.parent ?? "")) query = query.eq("parent_status", filters.parent!);
  const search = (filters.query ?? "").trim().slice(0, 100).replace(/[\\%_]/g, "\\$&");
  const searchColumn = ({ text: "post_text", handle: "x_handle", post_id: "post_id", archive: "source_archive" } as Record<string, string>)[filters.field ?? "text"];
  if (search && searchColumn) query = query.ilike(searchColumn, `%${search}%`);
  const { data, count, error } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as RawRow[];
  const makePageHref = (target: number) => {
    const params = new URLSearchParams({ mode: "raw_review", page: String(target) });
    for (const key of ["tier", "topic", "reply", "status", "stage", "parent", "field", "query"] as const) if (filters[key]) params.set(key, filters[key]);
    return `/admin/x-leads?${params}`;
  };
  return <AppShell admin><main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-3xl font-black">X 原始待筛帖子</h1>
        <p className="mt-2 text-sm text-muted">购物主题查询返回的原文，共 {count ?? 0} 条。未验证美国位置、宠物照片或买家资格；不在严格候选池，也不能从此页发送。</p></div>
      <div className="flex gap-3"><Link className="font-bold text-accent underline" href="/admin/x-leads">严格候选</Link><Link className="font-bold text-accent underline" href="/admin/x-lead-search">发现任务</Link></div>
    </div>
    <form className="mt-5 flex flex-wrap gap-3 rounded-xl border border-line bg-panel p-4 text-sm">
      <input type="hidden" name="mode" value="raw_review" />
      <Filter name="tier" label="文本判断" value={filters.tier} options={[["", "全部"], ["explicit_request", "明确请求"], ["exploratory", "探索"], ["excluded", "排除"]]} />
      <Filter name="topic" label="正文宠物与商品词" value={filters.topic} options={[["", "全部"], ["true", "有"], ["false", "无"]]} />
      <Filter name="reply" label="回复帖" value={filters.reply} options={[["", "全部"], ["true", "是"], ["false", "否"]]} />
      <Filter name="status" label="人工状态" value={filters.status} options={[["", "全部"], ["unreviewed", "未处理"], ["dismissed", "已忽略"]]} />
      <Filter name="stage" label="查询组" value={filters.stage} options={[["", "全部"], ["shopping_broad", "宽购物"], ["buyer_recommend_pillow", "枕头推荐"], ["shopping_pet_product", "宠物商品"], ["shopping_pet_broad", "宽宠物商品"], ["buyer_where_pillow", "枕头购买地点"], ["shopping_product_only", "宽商品"]]} />
      <Filter name="parent" label="父帖" value={filters.parent} options={[["", "全部"], ["not_applicable", "非回复"], ["unresolved", "待核实"], ["resolved_product_mismatch", "已核实不匹配"]]} />
      <Filter name="field" label="查找字段" value={filters.field} options={[["text", "正文"], ["handle", "账号"], ["post_id", "帖子 ID"], ["archive", "来源档案"]]} />
      <label className="flex flex-col gap-1 font-bold">关键词<input className="rounded-lg border border-line bg-white px-3 py-2" type="search" name="query" maxLength={100} defaultValue={filters.query ?? ""} /></label>
      <button className="rounded-lg bg-accent px-4 py-2 font-bold text-accent-ink" type="submit">筛选</button>
    </form>
    <div className="mt-5 space-y-4">{rows.map((row) => <article className="rounded-xl border border-line bg-panel p-4" key={row.post_id}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><a className="font-black text-accent underline" href={row.post_url} target="_blank" rel="noopener noreferrer">@{row.x_handle} · 原帖 {row.post_id}</a><span>{row.posted_at ? formatAdminDate(row.posted_at) : "帖子时间未知"}</span></div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{row.post_text || "（无正文）"}</p>
      {row.post_text.length >= 3000 ? <p className="text-xs text-muted">正文显示前 3000 字；完整原文见原帖或本机原始归档。</p> : null}
      <div className="mt-3 flex flex-wrap gap-2 text-xs"><Tag>文本：{row.classifier_tier}</Tag><Tag>正文主题：{row.body_topic_match ? "匹配" : "未匹配"}</Tag><Tag>人工：{row.review_status}</Tag>{row.is_reply ? <Tag>回复 · {row.parent_status}</Tag> : null}</div>
      <p className="mt-3 text-xs text-muted">排除理由：{row.exclusion_reasons.length ? row.exclusion_reasons.join("、") : "无"} · 分类器 {row.classifier_version}</p>
      {row.parent_evidence ? <p className="mt-2 whitespace-pre-wrap rounded-lg border border-line p-3 text-xs">父帖 {row.parent_post_id}：{row.parent_evidence}<br />归档：{row.parent_source_archive}</p> : null}
      <p className="mt-2 text-xs text-muted">来源：{row.source_stage} · {row.source_archive} · 首次留存 {formatAdminDate(row.first_seen_at)}</p>
      <form action={setRawReviewStatus} className="mt-3"><input type="hidden" name="postId" value={row.post_id} /><input type="hidden" name="status" value={row.review_status === "dismissed" ? "unreviewed" : "dismissed"} /><button className="rounded-lg border border-line px-3 py-2 text-xs font-bold" type="submit">{row.review_status === "dismissed" ? "恢复待审" : "忽略此帖"}</button></form>
    </article>)}</div>
    {!rows.length ? <p className="mt-8 text-center text-muted">此筛选下暂无原始帖。</p> : null}
    <div className="mt-5 flex gap-4 text-sm font-bold">{page > 1 ? <Link href={makePageHref(page - 1)}>上一页</Link> : null}{page * pageSize < (count ?? 0) ? <Link href={makePageHref(page + 1)}>下一页</Link> : null}</div>
  </main></AppShell>;
}

function Filter({ name, label, value, options }: { name: string; label: string; value?: string; options: Array<[string, string]> }) {
  return <label className="flex flex-col gap-1 font-bold">{label}<select className="rounded-lg border border-line bg-white px-3 py-2" name={name} defaultValue={value ?? ""}>{options.map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select></label>;
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md border border-line bg-white px-2 py-1 font-bold">{children}</span>;
}
