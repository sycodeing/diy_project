import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import {
  marketingChannelLabel,
  marketingStageLabel,
  MARKETING_STAGES,
  type MarketingReportRow,
  summarizeMarketing,
} from "@/lib/marketing-report";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/utils";

type Search = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function MarketingPage({ searchParams }: { searchParams: Search }) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <AppShell admin><main className="mx-auto w-full max-w-3xl px-4 py-10"><SetupWarning /></main></AppShell>;
  }
  await requireAdmin("/admin/marketing");
  const filters = await searchParams;
  const get = (key: string) => typeof filters[key] === "string" ? filters[key] as string : "";

  let query = supabase
    .from("marketing_links")
    .select("id,campaign,channel,variant,source_hash,click_count,created_at,expires_at,marketing_events(event_type,created_at,order_id),marketing_link_visits(id,visited_at,device_class,referrer_group,suspected_bot,is_internal),orders(id,order_number,amount_cents,currency,payment_status,paid_at)")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (get("from")) query = query.gte("created_at", `${get("from")}T00:00:00.000Z`);
  if (get("to")) query = query.lte("created_at", `${get("to")}T23:59:59.999Z`);
  if (get("campaign")) query = query.eq("campaign", get("campaign"));
  if (get("channel")) query = query.eq("channel", get("channel"));
  if (get("variant")) query = query.eq("variant", get("variant"));

  const { data, error } = await query;
  const rows = (data ?? []) as unknown as MarketingReportRow[];
  const summary = summarizeMarketing(rows);
  const channelSummary = ["consent_reply", "public_reply", "direct_message"].map((channel) => {
    const channelRows = rows.filter((row) => row.channel === channel);
    return { channel, generated: channelRows.length, ...summarizeMarketing(channelRows) };
  });
  const selected = rows.find((row) => row.id === get("link"));
  const selectedTimeline = selected ? buildTimeline(selected) : [];
  const exportParams = new URLSearchParams();
  for (const key of ["from", "to", "campaign", "channel", "variant"]) {
    if (get(key)) exportParams.set(key, get(key));
  }

  return (
    <AppShell admin>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><h1 className="text-4xl font-black">营销数据</h1></div>
          <Link className="focus-ring rounded-lg border border-line px-4 py-2 font-bold hover:bg-surface" href={`/api/admin/marketing/export?${exportParams}`}>导出 CSV</Link>
        </div>

        <form className="mt-6 grid gap-3 rounded-lg border border-line bg-panel/80 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <FilterInput label="开始日期" name="from" type="date" value={get("from")} />
          <FilterInput label="结束日期" name="to" type="date" value={get("to")} />
          <FilterInput label="营销活动" name="campaign" value={get("campaign")} />
          <FilterInput label="渠道" name="channel" value={get("channel")} />
          <FilterInput label="版本" name="variant" value={get("variant")} />
          <button className="focus-ring mt-auto h-11 rounded-lg bg-accent px-4 font-black text-accent-ink" type="submit">筛选</button>
        </form>

        {error ? <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error.message}</p> : null}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Metric label="已生成链接" value={summary.stageCounts.link_generated} />
          <Metric label="跳转请求（原始）" value={summary.totalClicks} />
          <Metric label="未标记异常的请求" value={summary.qualifiedRedirects} />
          <Metric label="已排除请求" value={summary.excludedRedirects} />
          <Metric label="已支付订单" value={summary.paidOrders} />
          <Metric label="营业额" value={formatMoney(summary.revenue, "usd")} />
          <Metric label="平均订单金额" value={formatMoney(summary.averageOrderValue, "usd")} />
        </section>

        <section className="mt-6 overflow-x-auto rounded-lg border border-line bg-panel/80 p-4">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-muted"><tr><th className="pb-3">漏斗阶段</th>{MARKETING_STAGES.map((stage) => <th className="pb-3" key={stage}>{marketingStageLabel(stage)}</th>)}</tr></thead>
            <tbody><tr className="border-t border-line"><th className="py-4">去重链接数</th>{MARKETING_STAGES.map((stage, index) => {
              const count = summary.stageCounts[stage];
              const prior = index ? summary.stageCounts[MARKETING_STAGES[index - 1]] : count;
              return <td className="py-4" key={stage}><span className="font-black">{count}</span><span className="ml-2 text-muted">{index ? `${prior ? Math.round(count / prior * 100) : 0}%` : "100%"}</span></td>;
            })}</tr></tbody>
          </table>
          <p className="text-sm text-muted">链接生成 → 支付完成：{summary.stageCounts.link_generated ? (summary.stageCounts.payment_completed / summary.stageCounts.link_generated * 100).toFixed(1) : "0.0"}%</p>
          <p className="mt-1 text-xs text-muted">“收到跳转请求”只表示服务器执行了重定向，可能来自 X 预览机器人、内部检查或真人；“已打开设计器”起才是浏览器确认行为。漏斗按每条营销链接的阶段去重。</p>
        </section>

        <section className="mt-6 overflow-x-auto rounded-lg border border-line bg-panel/80 p-4">
          <h2 className="text-xl font-black">触达方式对比</h2>
          <table className="mt-4 w-full min-w-[640px] text-left text-sm">
            <thead className="text-muted"><tr><th className="pb-3">触达方式</th><th>生成链接</th><th>有跳转请求</th><th>支付订单</th><th>生成 → 支付</th><th>营业额</th></tr></thead>
            <tbody>{channelSummary.map((item) => <tr className="border-t border-line" key={item.channel}><th className="py-3">{marketingChannelLabel(item.channel)}</th><td>{item.generated}</td><td>{item.stageCounts.link_clicked}</td><td>{item.paidOrders}</td><td>{item.generated ? (item.paidOrders / item.generated * 100).toFixed(1) : "0.0"}%</td><td>{formatMoney(item.revenue, "usd")}</td></tr>)}</tbody>
          </table>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="overflow-x-auto rounded-lg border border-line bg-panel/80 p-4">
            <table className="w-full min-w-[760px] text-left text-sm"><thead className="text-muted"><tr><th className="pb-3">创建时间</th><th>营销活动</th><th>渠道 / 版本</th><th>跳转请求</th><th>最后阶段</th><th /></tr></thead><tbody>{rows.map((row) => {
              const reached = MARKETING_STAGES.filter((stage) => row.marketing_events.some((event) => event.event_type === stage));
              return <tr className="border-t border-line" key={row.id}><td className="py-3">{formatDate(row.created_at)}</td><td>{row.campaign}</td><td>{marketingChannelLabel(row.channel)} / {row.variant}</td><td>{row.click_count}</td><td>{reached.at(-1) ? marketingStageLabel(reached.at(-1)!) : "—"}</td><td><Link className="text-accent" href={{ query: { ...Object.fromEntries(exportParams), link: row.id } }}>查看明细</Link></td></tr>;
            })}</tbody></table>
          </div>
          <aside className="rounded-lg border border-line bg-panel/80 p-4">
            <h2 className="text-xl font-black">匿名访问时间线</h2>
            {selected ? <><p className="mt-1 break-all font-mono text-xs text-muted">{selected.source_hash.slice(0, 16)}…</p><p className="mt-3 text-sm font-semibold">累计收到 {selected.click_count} 次跳转请求</p>{selected.click_count > selected.marketing_link_visits.length ? <p className="mt-1 text-xs text-muted">其中 {selected.click_count - selected.marketing_link_visits.length} 次为逐次明细功能上线前的历史请求，仅保留累计数。</p> : null}<ol className="mt-4 space-y-3">{selectedTimeline.map((event) => <li className="border-l-2 border-accent pl-3" key={event.key}><p className="font-bold">{event.label}</p><p className="text-xs text-muted">{formatDate(event.createdAt)}</p>{event.orderId ? <Link className="text-sm text-accent" href={`/admin/orders/${event.orderId}`}>查看订单</Link> : null}</li>)}</ol></> : <p className="mt-3 text-sm text-muted">选择一条链接，查看每次跳转请求、浏览器确认阶段和关联订单。</p>}
          </aside>
        </section>
      </main>
    </AppShell>
  );
}

function buildTimeline(row: MarketingReportRow) {
  const visits = row.marketing_link_visits.map((visit) => ({
    key: `visit:${visit.id}`,
    label: visit.is_internal ? "内部测试跳转请求" : visit.suspected_bot ? "疑似机器人跳转请求" : "跳转请求",
    createdAt: visit.visited_at,
    orderId: null as string | null,
  }));
  const events = row.marketing_events
    .filter((event) => event.event_type !== "link_clicked" || !visits.length)
    .map((event) => ({
      key: `event:${event.event_type}:${event.order_id ?? "none"}`,
      label: marketingStageLabel(event.event_type),
      createdAt: event.created_at,
      orderId: event.order_id,
    }));
  return [...events, ...visits].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function FilterInput({ label, name, type = "text", value }: { label: string; name: string; type?: string; value: string }) {
  return <label className="block"><span className="mb-2 block text-xs font-bold text-muted">{label}</span><input className="focus-ring h-11 w-full rounded-lg border border-line bg-white px-3 text-foreground" defaultValue={value} name={name} type={type} /></label>;
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <article className="rounded-lg border border-line bg-panel/80 p-4"><p className="text-sm text-muted">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></article>;
}
