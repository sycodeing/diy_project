import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import {
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
    return <AppShell><main className="mx-auto w-full max-w-3xl px-4 py-10"><SetupWarning /></main></AppShell>;
  }
  await requireAdmin("/admin/marketing");
  const filters = await searchParams;
  const get = (key: string) => typeof filters[key] === "string" ? filters[key] as string : "";

  let query = supabase
    .from("marketing_links")
    .select("id,campaign,channel,variant,source_hash,click_count,created_at,expires_at,marketing_events(event_type,created_at,order_id),orders(id,order_number,amount_cents,currency,payment_status,paid_at)")
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

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-accent">Admin / attribution</p><h1 className="mt-2 text-4xl font-black">Marketing funnel</h1></div>
          <Link className="focus-ring rounded-lg border border-line px-4 py-2 font-bold hover:bg-white/5" href={`/api/admin/marketing/export?${exportParams}`}>Export CSV</Link>
        </div>

        <form className="mt-6 grid gap-3 rounded-lg border border-line bg-panel/80 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <FilterInput label="From" name="from" type="date" value={get("from")} />
          <FilterInput label="To" name="to" type="date" value={get("to")} />
          <FilterInput label="Campaign" name="campaign" value={get("campaign")} />
          <FilterInput label="Channel" name="channel" value={get("channel")} />
          <FilterInput label="Variant" name="variant" value={get("variant")} />
          <button className="focus-ring mt-auto h-11 rounded-lg bg-accent px-4 font-black text-accent-ink" type="submit">Apply</button>
        </form>

        {error ? <p className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error.message}</p> : null}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Generated" value={summary.stageCounts.link_generated} />
          <Metric label="Paid orders" value={summary.paidOrders} />
          <Metric label="Revenue" value={formatMoney(summary.revenue, "usd")} />
          <Metric label="Average order" value={formatMoney(summary.averageOrderValue, "usd")} />
        </section>

        <section className="mt-6 overflow-x-auto rounded-lg border border-line bg-panel/80 p-4">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-muted"><tr><th className="pb-3">Stage</th>{MARKETING_STAGES.map((stage) => <th className="pb-3" key={stage}>{stage.replaceAll("_", " ")}</th>)}</tr></thead>
            <tbody><tr className="border-t border-line"><th className="py-4">Unique links</th>{MARKETING_STAGES.map((stage, index) => {
              const count = summary.stageCounts[stage];
              const prior = index ? summary.stageCounts[MARKETING_STAGES[index - 1]] : count;
              return <td className="py-4" key={stage}><span className="font-black">{count}</span><span className="ml-2 text-muted">{index ? `${prior ? Math.round(count / prior * 100) : 0}%` : "100%"}</span></td>;
            })}</tr></tbody>
          </table>
          <p className="text-sm text-muted">Generated → paid: {summary.stageCounts.link_generated ? (summary.stageCounts.payment_completed / summary.stageCounts.link_generated * 100).toFixed(1) : "0.0"}%</p>
        </section>

        <section className="mt-6 overflow-x-auto rounded-lg border border-line bg-panel/80 p-4">
          <h2 className="text-xl font-black">Outreach method comparison</h2>
          <table className="mt-4 w-full min-w-[640px] text-left text-sm">
            <thead className="text-muted"><tr><th className="pb-3">Method</th><th>Generated</th><th>Clicked</th><th>Paid</th><th>Generated → paid</th><th>Revenue</th></tr></thead>
            <tbody>{channelSummary.map((item) => <tr className="border-t border-line" key={item.channel}><th className="py-3">{item.channel.replaceAll("_", " ")}</th><td>{item.generated}</td><td>{item.stageCounts.link_clicked}</td><td>{item.paidOrders}</td><td>{item.generated ? (item.paidOrders / item.generated * 100).toFixed(1) : "0.0"}%</td><td>{formatMoney(item.revenue, "usd")}</td></tr>)}</tbody>
          </table>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="overflow-x-auto rounded-lg border border-line bg-panel/80 p-4">
            <table className="w-full min-w-[760px] text-left text-sm"><thead className="text-muted"><tr><th className="pb-3">Created</th><th>Campaign</th><th>Channel / variant</th><th>Clicks</th><th>Last stage</th><th /></tr></thead><tbody>{rows.map((row) => {
              const reached = MARKETING_STAGES.filter((stage) => row.marketing_events.some((event) => event.event_type === stage));
              return <tr className="border-t border-line" key={row.id}><td className="py-3">{formatDate(row.created_at)}</td><td>{row.campaign}</td><td>{row.channel} / {row.variant}</td><td>{row.click_count}</td><td>{reached.at(-1)?.replaceAll("_", " ") ?? "—"}</td><td><Link className="text-accent" href={{ query: { ...Object.fromEntries(exportParams), link: row.id } }}>Timeline</Link></td></tr>;
            })}</tbody></table>
          </div>
          <aside className="rounded-lg border border-line bg-panel/80 p-4">
            <h2 className="text-xl font-black">Anonymous timeline</h2>
            {selected ? <><p className="mt-1 break-all font-mono text-xs text-muted">{selected.source_hash.slice(0, 16)}…</p><ol className="mt-4 space-y-3">{selected.marketing_events.sort((a, b) => a.created_at.localeCompare(b.created_at)).map((event) => <li className="border-l-2 border-accent pl-3" key={event.event_type}><p className="font-bold">{event.event_type.replaceAll("_", " ")}</p><p className="text-xs text-muted">{formatDate(event.created_at)}</p>{event.order_id ? <Link className="text-sm text-accent" href={`/admin/orders/${event.order_id}`}>View order</Link> : null}</li>)}</ol></> : <p className="mt-3 text-sm text-muted">Select a link to inspect its events and order.</p>}
          </aside>
        </section>
      </main>
    </AppShell>
  );
}

function FilterInput({ label, name, type = "text", value }: { label: string; name: string; type?: string; value: string }) {
  return <label className="block"><span className="mb-2 block text-xs font-bold text-muted">{label}</span><input className="focus-ring h-11 w-full rounded-lg border border-line bg-black px-3" defaultValue={value} name={name} type={type} /></label>;
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <article className="rounded-lg border border-line bg-panel/80 p-4"><p className="text-sm text-muted">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></article>;
}
