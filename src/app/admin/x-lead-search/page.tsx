import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { formatAdminDate, getServerNowMillis } from "@/lib/utils";
import {
  X_JOB_STATUS_LABELS,
  X_LEAD_SEGMENTS,
  X_LEAD_SEGMENT_LABELS,
  X_SEARCH_INTERVAL_LABELS,
  X_SEARCH_PRODUCT_LABELS,
} from "@/lib/x-lead";
import { runAccountFirstSearch, runConsumerLeadSearch, runEngagementLeadSearch, runRecallLeadSearch, saveXLeadSearchConfiguration } from "./actions";
import { supportsAccountFirst } from "@/lib/x-lead-worker-version";

export const dynamic = "force-dynamic";

type SearchConfig = {
  id: string;
  enabled: boolean;
  segments: string[];
  search_product: string;
  result_limit: number;
  lookback_days: number;
  us_required: boolean;
  us_min_confidence: number;
  interval_minutes: number;
  next_run_at: string | null;
  last_enqueued_at: string | null;
};

type SearchJob = {
  id: string;
  trigger_type: string;
  status: string;
  received_count: number;
  inserted_count: number;
  worker_id: string | null;
  error_message: string | null;
  metrics: Record<string, unknown> | null;
  configuration: { discoveryMode?: string } | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

type Worker = {
  worker_id: string;
  worker_version: string | null;
  status: string;
  cookie_configured: boolean;
  last_error: string | null;
  last_seen_at: string;
};

const defaults: SearchConfig = {
  id: "",
  enabled: false,
  segments: [...X_LEAD_SEGMENTS],
  search_product: "Latest",
  result_limit: 40,
  lookback_days: 30,
  us_required: true,
  us_min_confidence: 70,
  interval_minutes: 1440,
  next_run_at: null,
  last_enqueued_at: null,
};

export default async function XLeadSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  await requireAdmin("/admin/x-lead-search");
  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return <AppShell admin><main className="mx-auto w-full max-w-3xl px-4 py-10"><SetupWarning /></main></AppShell>;
  }

  const [{ data: configData }, { data: jobsData }, { data: workersData }] = await Promise.all([
    supabase.from("x_lead_search_configs").select("*").eq("config_key", "default").maybeSingle(),
    supabase.from("x_lead_search_jobs").select("id,trigger_type,status,received_count,inserted_count,worker_id,error_message,metrics,configuration,started_at,finished_at,created_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("x_lead_workers").select("worker_id,worker_version,status,cookie_configured,last_error,last_seen_at").order("last_seen_at", { ascending: false }).limit(1),
  ]);
  const config = (configData ?? defaults) as SearchConfig;
  const jobs = (jobsData ?? []) as SearchJob[];
  const worker = ((workersData ?? [])[0] ?? null) as Worker | null;
  const workerOnline = Boolean(worker && getServerNowMillis() - new Date(worker.last_seen_at).getTime() < 120_000);
  const { notice } = await searchParams;
  const noticeText = notice === "account-queued" ? "账号证据任务已手动入队；仅写独立待审账号，不发送。" : notice === "consumer-queued" ? "三画像召回任务已入队。帖子仅进入原始待筛，不会发送或生成预览。" : notice === "recall-queued" ? "宽召回任务已入队。原始帖子仅进入待筛视图，不会生成预览或发送消息。" : notice === "queued"
    ? "筛选任务已加入队列，本机执行器会自动领取。"
    : notice === "saved"
      ? "筛选与定时配置已保存。"
      : notice === "active"
        ? "已有任务正在等待或执行，请完成后再启动。"
        : null;

  return (
    <AppShell admin>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black">X 用户筛选</h1>
            <p className="mt-2 text-sm text-muted">配置筛选条件、手动启动任务，或按周期自动加入本机执行队列。</p>
          </div>
          <Link className="focus-ring rounded-lg bg-accent px-4 py-2 font-black text-accent-ink" href="/admin/x-leads">查看筛选结果</Link>
        </div>

        {noticeText ? <p className="mt-5 rounded-lg border border-line bg-panel p-3 text-sm font-bold">{noticeText}</p> : null}

        <section className="mt-6 rounded-xl border border-line bg-panel/90 p-5">
          <h2 className="text-xl font-black">账号证据 · 已核实讨论种子</h2>
          <p className="mt-2 text-sm text-muted">手动输入已核实的原帖，读取真实回复者和最多四位作者的近期本人内容。按账号分开记录个人证据、商品行为与当前交流入口；仅晒宠进入观察，不等于商品需求。原帖与图片元数据不能证明归属。任务仅写账号待审，不进严格候选或发送队列。</p>
          <form action={runAccountFirstSearch} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-bold">种子原帖链接或 ID<input className="mt-1 w-full rounded-lg border border-line bg-surface p-3" name="seedPost" placeholder="https://x.com/user/status/…" required /></label>
            <label className="text-sm font-bold">核实依据<input className="mt-1 w-full rounded-lg border border-line bg-surface p-3" name="seedVerificationNote" minLength={12} maxLength={1000} placeholder="原帖确有相关回复；仅作为上下文" required /></label>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><button className="focus-ring rounded-lg bg-accent px-4 py-3 font-bold text-accent-ink" type="submit" disabled={!workerOnline || !supportsAccountFirst(worker?.worker_version ?? undefined)}>手动开始账号证据任务</button><Link className="font-bold text-accent underline" href="/admin/x-leads?mode=account_review">查看账号待审</Link></div>
          </form>
          <p className="mt-2 text-xs text-muted">需在线 1.19.3 执行器；最坏预留 1575 credits，硬上限 1800、余额保底 3000。当前不会自动启动任务。</p>
        </section>

        <section className="mt-6 rounded-xl border border-line bg-panel/90 p-5">
          <h2 className="text-xl font-black">个人分享 · 真实线程参与 · 自用作品</h2>
          <p className="mt-2 text-sm text-muted">本轮两类相关线程的真实回复者，以及个人视觉作品作者；历史宠物分享批次仍可单独查看。先保存原始页，再把账号证据、当前帖交流入口、商品关联分开审阅。线程种子不是候选；原帖图片与本地模型判断均不能证明归属或联系资格。</p>
          <form action={runEngagementLeadSearch} className="mt-4 flex flex-wrap gap-3">
            <button className="focus-ring rounded-lg bg-accent px-4 py-3 font-bold text-accent-ink" type="submit">启动一次有界对话来源测试</button>
            <Link className="focus-ring rounded-lg border border-line px-4 py-3 font-bold" href="/admin/x-leads?mode=raw_review">查看原始待筛</Link>
          </form>
          <p className="mt-2 text-xs text-muted">最近 3 天；2 类线程种子和 1 类个人作品各搜索 1 页，回复数与种子内容在本地核验；每类种子最多取 1 个回复首页、10 位独立回复者；作品最多 20 位作者。TwitterAPI 总预算 1800 credits，余额保底 3000。仅原始待审，不生成严格候选或发送任务；需在线 1.18.3 执行器。</p>
        </section>

        <section className="mt-6 rounded-xl border border-line bg-panel/90 p-5">
          <h2 className="text-xl font-black">三类个人生活场景 · 新原始待筛</h2>
          <p className="mt-2 text-sm text-muted">本人宠物故事、居住空间布置、重要关系回忆。六组短查询各最多一页；无需购物用语，由原帖证据决定待审分类。需要 1.17.3 发现执行器。购买意向和照片归属均待核实；不进入严格候选或发送队列。</p>
          <form action={runConsumerLeadSearch} className="mt-4 flex flex-wrap items-end gap-3">
            <SelectField label="本次最多搜索页数" name="maxPages" value="6" options={[["3", "3 页（每画像一组）"], ["6", "6 页（每画像两组）"]]} />
            <button className="focus-ring rounded-lg bg-accent px-4 py-3 font-bold text-accent-ink" type="submit">启动生活场景小批测试</button>
            <Link className="focus-ring rounded-lg border border-line px-4 py-3 font-bold" href="/admin/x-leads?mode=raw_review">查看原始待筛</Link>
          </form>
          <p className="mt-2 text-xs text-muted">最近 3 天，最多 6 搜索页；余额至少 3000 credits、观察支出最多 2500 credits。无自动定时、无控制页、无联系动作。</p>
        </section>

        <section className="mt-6 rounded-xl border border-line bg-panel/90 p-5">
          <h2 className="text-xl font-black">个人消费场景召回 · 原始待筛</h2>
          <p className="mt-2 text-sm text-muted">需要 1.15.0 或更新的发现执行器。优先搜索近期送礼与家居个性化场景，再由 v9 文本规则区分潜在顾客、明确需求、商家与噪音。保存原文、分类理由与来源供人工筛选；这里的帖子均未取得美国位置、宠物照片或联系资格。</p>
          <form action={runRecallLeadSearch} className="mt-4 space-y-4">
            <SelectField label="本次最多搜索页数" name="maxPages" value="2" options={[["1", "1 页"], ["2", "2 页"], ["3", "3 页（含明确买家组）"], ["8", "8 页（上限）"]]} />
            <p className="text-xs text-muted">最近 3 天，按有界宽查询逐级回退；余额低于 3000 credits 或本轮观察支出达到 2500 credits 即停止。普通 dog 控制页默认关闭。每页原始响应先在本机归档，结果只写原始待筛表，不进入严格候选或发送队列。</p>
            <div className="flex flex-wrap gap-3">
              <button className="focus-ring rounded-lg bg-accent px-4 py-3 font-bold text-accent-ink" type="submit">启动宽召回待筛</button>
              <Link className="focus-ring rounded-lg border border-line px-4 py-3 font-bold" href="/admin/x-leads?mode=raw_review">查看原始待筛帖子</Link>
            </div>
          </form>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <form action={saveXLeadSearchConfiguration} className="rounded-xl border border-line bg-panel/90 p-5">
            <h2 className="text-xl font-black">原模式：宠物照片 / 场景筛选</h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <fieldset>
                <legend className="text-sm font-black">目标人群</legend>
                <div className="mt-3 space-y-2">
                  {X_LEAD_SEGMENTS.map((segment) => (
                    <label className="flex items-center gap-3 rounded-lg border border-line p-3" key={segment}>
                      <input defaultChecked={config.segments.includes(segment)} name="segments" type="checkbox" value={segment} />
                      <span className="font-bold">{X_LEAD_SEGMENT_LABELS[segment]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-4">
                <SelectField label="排序方式" name="searchProduct" value={config.search_product} options={Object.entries(X_SEARCH_PRODUCT_LABELS)} />
                <SelectField label="帖子时间范围" name="lookbackDays" value={String(config.lookback_days)} options={[["7", "最近 7 天"], ["14", "最近 14 天"], ["30", "最近 30 天"], ["60", "最近 60 天"], ["90", "最近 90 天"]]} />
                <NumberField label="每次最多筛选人数" name="resultLimit" value={config.result_limit} min={1} max={100} />
              </div>
            </div>

            <div className="mt-5 grid gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2">
              <label className="flex items-center gap-3 text-sm font-bold">
                <input defaultChecked={config.us_required} name="usRequired" type="checkbox" />
                只保留有美国公开位置证据的用户
              </label>
              <NumberField label="美国位置最低可信度" name="usMinConfidence" value={config.us_min_confidence} min={0} max={100} />
            </div>

            <div className="mt-5 rounded-lg border border-line p-4">
              <label className="flex items-center gap-3 font-black">
                <input defaultChecked={config.enabled} name="scheduleEnabled" type="checkbox" />
                启用定时筛选
              </label>
              <div className="mt-4 max-w-sm">
                <SelectField label="执行频率" name="intervalMinutes" value={String(config.interval_minutes)} options={Object.entries(X_SEARCH_INTERVAL_LABELS).map(([value, label]) => [value, label])} />
              </div>
              <p className="mt-3 text-xs text-muted">{config.enabled && config.next_run_at ? `下一次入队：${formatAdminDate(config.next_run_at)}` : "当前未启用定时筛选。"}</p>
              <p className="mt-2 text-xs text-muted">数据库每小时检查一次到期配置，实际入队时间最多可能晚约 1 小时。</p>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button className="focus-ring h-11 rounded-lg border border-line px-4 font-black hover:bg-surface" name="intent" type="submit" value="save">保存配置</button>
              <button className="focus-ring h-11 rounded-lg bg-accent px-5 font-black text-accent-ink" name="intent" type="submit" value="run">保存并立即筛选</button>
            </div>
          </form>

          <aside className="rounded-xl border border-line bg-panel/90 p-5">
            <h2 className="text-xl font-black">本机数据执行器</h2>
            <div className={`mt-4 rounded-lg border p-4 ${workerOnline && worker?.cookie_configured ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
              <p className="font-black">{workerOnline ? (worker?.cookie_configured ? "在线，数据源已配置" : "在线，但未配置 TwitterAPI.io Key") : "当前离线"}</p>
              <p className="mt-2 text-xs text-muted">{worker ? `${worker.worker_id} · 最后心跳 ${formatAdminDate(worker.last_seen_at)}` : "尚未收到本机脚本心跳。"}</p>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted">当前默认使用 TwitterAPI.io 做只读增量发现。API Key 与原始响应只留在本机；旧 Apify 与 X Cookie 代码仍保留，但不会自动回落调用。</p>
            {worker?.last_error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{worker.last_error}</p> : null}
          </aside>
        </section>

        <section className="mt-6 overflow-x-auto rounded-xl border border-line bg-panel/90 p-5">
          <h2 className="text-xl font-black">最近任务</h2>
          <table className="mt-4 w-full min-w-[860px] text-left text-sm">
            <thead className="text-muted"><tr><th className="pb-3">创建时间</th><th>触发方式</th><th>状态</th><th>帖子/账号数</th><th>发现漏斗</th><th>严格候选入库</th><th>执行器</th><th>结果</th></tr></thead>
            <tbody>{jobs.map((job) => <tr className="border-t border-line" key={job.id}>
              <td className="py-3">{formatAdminDate(job.created_at)}</td>
              <td>{job.configuration?.discoveryMode === "account_first" ? "账号证据待审 · " : job.configuration?.discoveryMode === "engagement_recall" ? "对话来源待筛 · " : job.configuration?.discoveryMode === "consumer_recall" ? "生活场景待筛 · " : job.configuration?.discoveryMode === "purchase_recall" ? "宽召回待筛 · " : job.configuration?.discoveryMode === "purchase_intent" ? "需求验证 · " : "原模式 · "}{job.trigger_type === "manual" ? "手动" : "定时"}</td>
              <td className="font-bold">{X_JOB_STATUS_LABELS[job.status] ?? job.status}</td>
              <td>{job.configuration?.discoveryMode === "account_first" ? `${job.received_count} 账号` : ["purchase_recall", "consumer_recall", "engagement_recall"].includes(job.configuration?.discoveryMode ?? "") ? `${job.received_count} 新帖` : job.received_count}</td><td className="min-w-52 text-xs leading-5 text-muted">{job.configuration?.discoveryMode === "account_first" ? <>真实回复 {metricNumber(job.metrics ?? {}, "returned_replies") ?? "—"} · 独立账号 {metricNumber(job.metrics ?? {}, "distinct_reply_authors") ?? "—"} · 近期补证 {metricNumber(job.metrics ?? {}, "accounts_enriched") ?? "—"}<Link className="mt-1 block font-bold text-accent underline" href={`/admin/x-leads?mode=account_review&job=${job.id}`}>查看本任务账号</Link></> : <>{formatDiscoveryMetrics(job.metrics, ["purchase_recall", "consumer_recall", "engagement_recall"].includes(job.configuration?.discoveryMode ?? ""))}{["purchase_recall", "consumer_recall", "engagement_recall"].includes(job.configuration?.discoveryMode ?? "") ? <Link className="mt-1 block font-bold text-accent underline" href={rawReviewHref(job.metrics)}>{hasRawReviewArchive(job.metrics) ? "查看本任务原始帖" : "查看全部原始帖"}</Link> : null}</>}</td><td>{job.inserted_count}</td><td>{job.worker_id ?? "—"}</td>
              <td className="max-w-80 text-muted">{job.error_message ?? (job.finished_at ? `完成于 ${formatAdminDate(job.finished_at)}` : "—")}</td>
            </tr>)}</tbody>
          </table>
          {!jobs.length ? <p className="py-8 text-center text-muted">还没有筛选任务。</p> : null}
        </section>
      </main>
    </AppShell>
  );
}

function rawReviewHref(metrics: Record<string, unknown> | null) {
  const archiveId = typeof metrics?.archive_id === "string" ? metrics.archive_id : "";
  if (!hasRawReviewArchive(metrics)) return "/admin/x-leads?mode=raw_review&tier=all";
  return `/admin/x-leads?mode=raw_review&tier=all&field=archive&query=${encodeURIComponent(`${archiveId}.json`)}`;
}

function hasRawReviewArchive(metrics: Record<string, unknown> | null) {
  return typeof metrics?.archive_id === "string" && /^[A-Za-z0-9._-]{1,190}$/.test(metrics.archive_id);
}

function formatDiscoveryMetrics(metrics: Record<string, unknown> | null, recall = false) {
  if (recall) {
    const rawRows = metrics ? metricNumber(metrics, "raw_review_rows") : null;
    const newPosts = metrics ? metricNumber(metrics, "retrieved_new_posts") ?? metricNumber(metrics, "shopping_query_new_posts_vs_baseline") : null;
    const pages = metrics ? metricNumber(metrics, "search_pages") : null;
    const tierValue = metrics?.text_tiers ?? metrics?.shopping_text_tiers;
    const tiers = tierValue && typeof tierValue === "object"
      ? tierValue as Record<string, unknown> : null;
    const potential = tiers && typeof tiers.exploratory === "number" ? tiers.exploratory : null;
    const explicit = tiers && typeof tiers.explicit_request === "number" ? tiers.explicit_request : null;
    const personas = metrics?.persona_unique_authors && typeof metrics.persona_unique_authors === "object"
      ? metrics.persona_unique_authors as Record<string, unknown> : null;
    const groups = metrics?.group_authors && typeof metrics.group_authors === "object"
      ? metrics.group_authors as Record<string, unknown> : null;
    const newThreadExperiment = Array.isArray(metrics?.stages)
      && metrics.stages.some((stage) => stage && typeof stage === "object"
        && "name" in stage && stage.name === "pet_photo_invite_seed");
    return [`原始待筛 ${rawRows ?? "—"}`, `新帖 ${newPosts ?? "—"}`, `潜在 ${potential ?? "—"}`,
      ...(personas ? ("pet_owner" in personas
        ? [`宠物 ${personas.pet_owner ?? 0} 人`, `家居 ${personas.home_decorator ?? 0} 人`, `关系回忆 ${personas.relationship_memory ?? 0} 人`]
        : [`旧送礼 ${personas.gift_giver ?? 0} 人`, `旧兴趣 ${personas.identity_consumer ?? 0} 人`, `旧活动 ${personas.group_organizer ?? 0} 人`]) : []),
      ...(groups ? [...(newThreadExperiment ? [] : [`宠物分享 ${groups.pet_share ?? 0} 人`]), `线程参与 ${groups.thread_participant ?? 0} 人`, `自用作品 ${groups.personal_make ?? 0} 人`, `待审池 ${metricNumber(metrics!, "review_pool_posts") ?? 0}`, `可拟草稿 ${metricNumber(metrics!, "draft_ready_posts") ?? 0}`] : []),
      `明确 ${explicit ?? "—"}`, `搜索 ${pages ?? "—"} 页`, "严格资格 0"].join(" · ");
  }
  if (!metrics || typeof metrics.provider !== "string") return "—";
  const parts = [metrics.provider];
  const uniquePosts = metricNumber(metrics, "unique_posts");
  const photoPosts = metricNumber(metrics, "photo_posts");
  const candidatePosts = metricNumber(metrics, "candidate_posts");
  const existingCandidates = metricNumber(metrics, "existing_candidates");
  const targetingReview = metricNumber(metrics, "targeting_review_status");
  const aboutCandidates = metricNumber(metrics, "about_candidates");
  const aboutApiCalls = metricNumber(metrics, "about_api_calls");
  const aboutCacheHits = metricNumber(metrics, "about_cache_hits");
  const aboutUsAccounts = metricNumber(metrics, "about_us_accounts");
  const aboutNonUsAccounts = metricNumber(metrics, "about_non_us_accounts");
  const aboutMissingAccounts = metricNumber(metrics, "about_missing_accounts");
  if (uniquePosts !== null) parts.push(`去重 ${uniquePosts}`);
  if (photoPosts !== null) parts.push(`含图 ${photoPosts}`);
  if (candidatePosts !== null) parts.push(`候选 ${candidatePosts}`);
  if (existingCandidates !== null) parts.push(`历史重复 ${existingCandidates}`);
  if (targetingReview !== null) parts.push(`文本复核 ${targetingReview}`);
  if (aboutCandidates !== null) parts.push(`位置补全 ${aboutCandidates}`);
  if (aboutApiCalls !== null) parts.push(`About 请求 ${aboutApiCalls}`);
  if (aboutCacheHits !== null) parts.push(`位置缓存 ${aboutCacheHits}`);
  if (aboutUsAccounts !== null) parts.push(`确认美国 ${aboutUsAccounts}`);
  if (aboutNonUsAccounts !== null) parts.push(`确认非美 ${aboutNonUsAccounts}`);
  if (aboutMissingAccounts !== null) parts.push(`位置缺失 ${aboutMissingAccounts}`);
  return parts.join(" · ");
}

function metricNumber(metrics: Record<string, unknown>, key: string) {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function SelectField({ label, name, value, options }: { label: string; name: string; value: string; options: Array<[string, string]> }) {
  return <label className="block text-sm font-bold">{label}<select className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" defaultValue={value} name={name}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function NumberField({ label, name, value, min, max }: { label: string; name: string; value: number; min: number; max: number }) {
  return <label className="block text-sm font-bold">{label}<input className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" defaultValue={value} max={max} min={min} name={name} required type="number" /></label>;
}
