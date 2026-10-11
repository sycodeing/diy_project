import { createHmac } from "node:crypto";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { getAppUrl, getMarketingIngestSecret } from "@/lib/env";
import {
  MARKETING_CHANNEL_LABELS,
  MARKETING_STAGE_LABELS,
  MARKETING_STAGES,
  type MarketingReportRow,
  summarizeMarketing,
} from "@/lib/marketing-report";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { formatMoney } from "@/lib/utils";

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
    .select("id,idempotency_key,campaign,channel,variant,source_hash,source_lead_id,x_handle,x_post_id,x_post_url,targeting_segment,lead_score,account_user_id,account_linked_at,account_was_created,click_count,created_at,expires_at,marketing_events(event_type,created_at,order_id),orders(id,order_number,amount_cents,currency,payment_status,paid_at)")
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
  const exportParams = new URLSearchParams();
  for (const key of ["from", "to", "campaign", "channel", "variant"]) {
    if (get(key)) exportParams.set(key, get(key));
  }

  const serviceSupabase = getSupabaseServiceClient();
  const accountIds = new Set(rows.flatMap((row) => row.account_user_id ? [row.account_user_id] : []));
  const accountEmailById = new Map<string, string>();
  if (serviceSupabase && accountIds.size) {
    const { data: users } = await serviceSupabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const user of users?.users ?? []) {
      if (accountIds.has(user.id) && user.email) accountEmailById.set(user.id, user.email);
    }
  }
  const secret = getMarketingIngestSecret();
  const appUrl = getAppUrl();
  const linkUrl = (row: MarketingReportRow) => secret
    ? `${appUrl}/go/${createHmac("sha256", secret).update(`marketing-link:${row.idempotency_key}`).digest("base64url")}`
    : null;

  return (
    <AppShell admin>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black">营销数据</h1>
            <p className="mt-2 text-sm text-muted">追踪 X 线索、专属链接、注册账号、结账与付款的完整链路。</p>
          </div>
          <Link className="focus-ring rounded-lg border border-line px-4 py-2 font-bold hover:bg-surface" href={`/api/admin/marketing/export?${exportParams}`}>导出 CSV</Link>
        </div>

        <form className="mt-6 grid gap-3 rounded-lg border border-line bg-panel/80 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <FilterInput label="起始日期" name="from" type="date" value={get("from")} />
          <FilterInput label="截止日期" name="to" type="date" value={get("to")} />
          <FilterInput label="活动" name="campaign" value={get("campaign")} />
          <FilterInput label="触达渠道" name="channel" value={get("channel")} />
          <FilterInput label="文案版本" name="variant" value={get("variant")} />
          <button className="focus-ring mt-auto h-11 rounded-lg bg-accent px-4 font-black text-accent-ink" type="submit">筛选</button>
        </form>

        {error ? <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">读取营销数据失败：{error.message}</p> : null}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="已生成链接" value={summary.stageCounts.link_generated} />
          <Metric label="已付款订单" value={summary.paidOrders} />
          <Metric label="销售额" value={formatMoney(summary.revenue, "usd")} />
          <Metric label="平均订单金额" value={formatMoney(summary.averageOrderValue, "usd")} />
        </section>

        <section className="mt-6 overflow-x-auto rounded-lg border border-line bg-panel/80 p-4">
          <h2 className="text-xl font-black">转化漏斗</h2>
          <table className="mt-4 w-full min-w-[1000px] text-left text-sm">
            <thead className="text-muted"><tr><th className="pb-3">统计口径</th>{MARKETING_STAGES.map((stage) => <th className="pb-3" key={stage}>{MARKETING_STAGE_LABELS[stage]}</th>)}</tr></thead>
            <tbody><tr className="border-t border-line"><th className="py-4">去重链接数</th>{MARKETING_STAGES.map((stage, index) => {
              const count = summary.stageCounts[stage];
              const prior = index ? summary.stageCounts[MARKETING_STAGES[index - 1]] : count;
              return <td className="py-4" key={stage}><span className="font-black">{count}</span><span className="ml-2 text-muted">{index ? `${prior ? Math.round(count / prior * 100) : 0}%` : "100%"}</span></td>;
            })}</tr></tbody>
          </table>
          <p className="text-sm text-muted">链接生成到付款转化率：{summary.stageCounts.link_generated ? (summary.stageCounts.payment_completed / summary.stageCounts.link_generated * 100).toFixed(1) : "0.0"}%</p>
        </section>

        <section className="mt-6 overflow-x-auto rounded-lg border border-line bg-panel/80 p-4">
          <h2 className="text-xl font-black">触达方式对比</h2>
          <table className="mt-4 w-full min-w-[640px] text-left text-sm">
            <thead className="text-muted"><tr><th className="pb-3">触达方式</th><th>已生成</th><th>已点击</th><th>已付款</th><th>生成到付款</th><th>销售额</th></tr></thead>
            <tbody>{channelSummary.map((item) => <tr className="border-t border-line" key={item.channel}><th className="py-3">{MARKETING_CHANNEL_LABELS[item.channel] ?? item.channel}</th><td>{item.generated}</td><td>{item.stageCounts.link_clicked}</td><td>{item.paidOrders}</td><td>{item.generated ? (item.paidOrders / item.generated * 100).toFixed(1) : "0.0"}%</td><td>{formatMoney(item.revenue, "usd")}</td></tr>)}</tbody>
          </table>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="overflow-x-auto rounded-lg border border-line bg-panel/80 p-4">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="text-muted"><tr><th className="pb-3">创建时间</th><th>X 用户</th><th>专属链接</th><th>活动</th><th>渠道 / 版本</th><th>点击</th><th>网站账号</th><th>最后阶段</th><th /></tr></thead>
              <tbody>{rows.map((row) => {
                const reached = MARKETING_STAGES.filter((stage) => row.marketing_events.some((event) => event.event_type === stage));
                const url = linkUrl(row);
                return <tr className="border-t border-line align-top" key={row.id}>
                  <td className="py-3 whitespace-nowrap">{formatDateZh(row.created_at)}</td>
                  <td className="py-3">{row.x_handle ? <><a className="font-bold text-accent" href={row.x_post_url ?? `https://x.com/${row.x_handle}`} rel="noreferrer" target="_blank">@{row.x_handle}</a><p className="text-xs text-muted">线索 #{row.source_lead_id ?? "—"}{row.lead_score === null ? "" : ` · ${row.lead_score} 分`}</p></> : <span className="text-muted">旧链接，未记录</span>}</td>
                  <td className="py-3">{url ? <a className="font-bold text-accent" href={url} rel="noreferrer" target="_blank">打开链接</a> : <span className="text-muted">配置缺失</span>}</td>
                  <td className="py-3">{row.campaign}</td>
                  <td className="py-3">{MARKETING_CHANNEL_LABELS[row.channel] ?? row.channel}<p className="text-xs text-muted">{row.variant}</p></td>
                  <td className="py-3">{row.click_count}</td>
                  <td className="py-3">{row.account_user_id ? <><span className="font-bold">{accountEmailById.get(row.account_user_id) ?? "已关联账号"}</span><p className="text-xs text-muted">{row.account_was_created ? "由此链接新注册" : "已有账号登录"}</p></> : <span className="text-muted">未关联</span>}</td>
                  <td className="py-3">{reached.at(-1) ? MARKETING_STAGE_LABELS[reached.at(-1)!] : "—"}</td>
                  <td className="py-3"><Link className="font-bold text-accent" href={{ query: { ...Object.fromEntries(exportParams), link: row.id } }}>查看链路</Link></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <aside className="rounded-lg border border-line bg-panel/80 p-4">
            <h2 className="text-xl font-black">完整归因链路</h2>
            {selected ? <ChainDetail row={selected} accountEmail={selected.account_user_id ? accountEmailById.get(selected.account_user_id) : undefined} url={linkUrl(selected)} /> : <p className="mt-3 text-sm text-muted">点击左侧“查看链路”，可核对 X 用户、链接、网站账号和订单。</p>}
          </aside>
        </section>
      </main>
    </AppShell>
  );
}

function ChainDetail({ row, accountEmail, url }: { row: MarketingReportRow; accountEmail?: string; url: string | null }) {
  const events = [...row.marketing_events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return <div className="mt-4 space-y-5 text-sm">
    <section><p className="text-xs font-bold text-muted">A · X 线索</p>{row.x_handle ? <><a className="mt-1 block font-black text-accent" href={row.x_post_url ?? `https://x.com/${row.x_handle}`} rel="noreferrer" target="_blank">@{row.x_handle}</a><p>本地线索编号：{row.source_lead_id ?? "—"}</p><p>帖子编号：{row.x_post_id ?? "—"}</p></> : <p className="mt-1 text-muted">该链接生成于升级前，没有 X 线索信息。</p>}</section>
    <section><p className="text-xs font-bold text-muted">B · 专属链接</p>{url ? <a className="mt-1 block break-all font-bold text-accent" href={url} rel="noreferrer" target="_blank">{url}</a> : <p className="mt-1 text-muted">营销密钥未配置，无法还原链接。</p>}</section>
    <section><p className="text-xs font-bold text-muted">C · 网站账号</p><p className="mt-1 font-bold">{row.account_user_id ? accountEmail ?? row.account_user_id : "尚未注册或登录"}</p>{row.account_user_id ? <p className="text-muted">{row.account_was_created ? "客户通过此链接创建了新账号" : "客户使用已有账号登录"}</p> : null}</section>
    <section><p className="text-xs font-bold text-muted">D · 订单与付款</p>{row.orders.length ? <ul className="mt-1 space-y-2">{row.orders.map((order) => <li key={order.id}><Link className="font-bold text-accent" href={`/admin/orders/${order.id}`}>{order.order_number}</Link><span className="ml-2">{formatMoney(order.amount_cents, order.currency)} · {order.payment_status === "paid" ? "已付款" : "未付款"}</span></li>)}</ul> : <p className="mt-1 text-muted">尚未创建订单。</p>}</section>
    <section><p className="text-xs font-bold text-muted">事件时间线</p><ol className="mt-2 space-y-3">{events.map((event) => <li className="border-l-2 border-accent pl-3" key={event.event_type}><p className="font-bold">{MARKETING_STAGE_LABELS[event.event_type as keyof typeof MARKETING_STAGE_LABELS] ?? event.event_type}</p><p className="text-xs text-muted">{formatDateZh(event.created_at)}</p></li>)}</ol></section>
  </div>;
}

function formatDateZh(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value));
}

function FilterInput({ label, name, type = "text", value }: { label: string; name: string; type?: string; value: string }) {
  return <label className="block"><span className="mb-2 block text-xs font-bold text-muted">{label}</span><input className="focus-ring h-11 w-full rounded-lg border border-line bg-white px-3 text-foreground" defaultValue={value} name={name} type={type} /></label>;
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <article className="rounded-lg border border-line bg-panel/80 p-4"><p className="text-sm text-muted">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></article>;
}
