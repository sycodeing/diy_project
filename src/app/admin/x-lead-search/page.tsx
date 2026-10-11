import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { formatAdminDate, getServerNowMillis } from "@/lib/utils";
import {
  X_JOB_STATUS_LABELS,
  X_LEAD_SEGMENT_LABELS,
  X_SEARCH_INTERVAL_LABELS,
  X_SEARCH_PRODUCT_LABELS,
} from "@/lib/x-lead";
import { saveXLeadSearchConfiguration } from "./actions";

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
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

type Worker = {
  worker_id: string;
  status: string;
  cookie_configured: boolean;
  last_error: string | null;
  last_seen_at: string;
};

const defaults: SearchConfig = {
  id: "",
  enabled: false,
  segments: ["new_adoption", "pet_birthday"],
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
    supabase.from("x_lead_search_jobs").select("id,trigger_type,status,received_count,inserted_count,worker_id,error_message,started_at,finished_at,created_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("x_lead_workers").select("worker_id,status,cookie_configured,last_error,last_seen_at").order("last_seen_at", { ascending: false }).limit(1),
  ]);
  const config = (configData ?? defaults) as SearchConfig;
  const jobs = (jobsData ?? []) as SearchJob[];
  const worker = ((workersData ?? [])[0] ?? null) as Worker | null;
  const workerOnline = Boolean(worker && getServerNowMillis() - new Date(worker.last_seen_at).getTime() < 120_000);
  const { notice } = await searchParams;
  const noticeText = notice === "queued"
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

        <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <form action={saveXLeadSearchConfiguration} className="rounded-xl border border-line bg-panel/90 p-5">
            <h2 className="text-xl font-black">筛选条件</h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <fieldset>
                <legend className="text-sm font-black">目标人群</legend>
                <div className="mt-3 space-y-2">
                  {["new_adoption", "pet_birthday"].map((segment) => (
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
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button className="focus-ring h-11 rounded-lg border border-line px-4 font-black hover:bg-surface" name="intent" type="submit" value="save">保存配置</button>
              <button className="focus-ring h-11 rounded-lg bg-accent px-5 font-black text-accent-ink" name="intent" type="submit" value="run">保存并立即筛选</button>
            </div>
          </form>

          <aside className="rounded-xl border border-line bg-panel/90 p-5">
            <h2 className="text-xl font-black">本机执行器</h2>
            <div className={`mt-4 rounded-lg border p-4 ${workerOnline && worker?.cookie_configured ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
              <p className="font-black">{workerOnline ? (worker?.cookie_configured ? "在线，可以执行" : "在线，但未配置 X Cookie") : "当前离线"}</p>
              <p className="mt-2 text-xs text-muted">{worker ? `${worker.worker_id} · 最后心跳 ${formatAdminDate(worker.last_seen_at)}` : "尚未收到本机脚本心跳。"}</p>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted">网站只保存任务和结果。X Cookie 始终留在你的电脑上，本机脚本启动后会自动领取任务。</p>
            {worker?.last_error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{worker.last_error}</p> : null}
          </aside>
        </section>

        <section className="mt-6 overflow-x-auto rounded-xl border border-line bg-panel/90 p-5">
          <h2 className="text-xl font-black">最近任务</h2>
          <table className="mt-4 w-full min-w-[860px] text-left text-sm">
            <thead className="text-muted"><tr><th className="pb-3">创建时间</th><th>触发方式</th><th>状态</th><th>获取帖子</th><th>新增用户</th><th>执行器</th><th>结果</th></tr></thead>
            <tbody>{jobs.map((job) => <tr className="border-t border-line" key={job.id}>
              <td className="py-3">{formatAdminDate(job.created_at)}</td>
              <td>{job.trigger_type === "manual" ? "手动" : "定时"}</td>
              <td className="font-bold">{X_JOB_STATUS_LABELS[job.status] ?? job.status}</td>
              <td>{job.received_count}</td><td>{job.inserted_count}</td><td>{job.worker_id ?? "—"}</td>
              <td className="max-w-80 text-muted">{job.error_message ?? (job.finished_at ? `完成于 ${formatAdminDate(job.finished_at)}` : "—")}</td>
            </tr>)}</tbody>
          </table>
          {!jobs.length ? <p className="py-8 text-center text-muted">还没有筛选任务。</p> : null}
        </section>
      </main>
    </AppShell>
  );
}

function SelectField({ label, name, value, options }: { label: string; name: string; value: string; options: Array<[string, string]> }) {
  return <label className="block text-sm font-bold">{label}<select className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" defaultValue={value} name={name}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function NumberField({ label, name, value, min, max }: { label: string; name: string; value: number; min: number; max: number }) {
  return <label className="block text-sm font-bold">{label}<input className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" defaultValue={value} max={max} min={min} name={name} required type="number" /></label>;
}

