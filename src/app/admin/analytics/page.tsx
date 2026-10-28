import { AppShell } from "@/components/app-shell";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import type { CustomerActivityEventType } from "@/lib/customer-activity";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ActivityRow = { session_id: string; event_type: CustomerActivityEventType; route: string; target: string | null; duration_seconds: number; order_id: string | null; device_class: string; referrer_group: string; suspected_bot: boolean; is_internal: boolean; created_at: string };
type SessionStat = { rows: ActivityRow[]; pages: Set<string>; seconds: number; clicks: number; lastSeen: string };

const routeLabels: Record<string, string> = { "/": "首页", "/design": "设计页", "/orders": "订单列表", "/orders/:id": "订单详情", "/checkout/success": "支付完成" };
const eventLabels: Partial<Record<CustomerActivityEventType, string>> = {
  landing_confirmed: "浏览器确认落地", design_opened: "打开设计器", upload_started: "开始上传", crop_confirmed: "确认裁剪", preview_started: "开始生成预览", preview_cache_hit: "命中预览缓存", preview_ready: "预览完成", delivery_opened: "打开配送信息", delivery_canceled: "退出配送信息", address_validation_failed: "地址校验失败", checkout_started: "创建付款会话", payment_redirected: "跳转付款页", purchase_completed: "付款完成",
};

export default async function AnalyticsPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <AppShell admin><main className="mx-auto w-full max-w-3xl px-4 py-10"><SetupWarning /></main></AppShell>;
  await requireAdmin("/admin/analytics");
  const since = getThirtyDaysAgo();
  const { data, error } = await supabase.from("customer_activity_events").select("session_id,event_type,route,target,duration_seconds,order_id,device_class,referrer_group,suspected_bot,is_internal,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(10000);
  const rows = (data ?? []) as ActivityRow[];
  const sessions = buildSessions(rows);
  const internalIds = matchingSessions(sessions, (stat) => stat.rows.some((row) => row.is_internal));
  const botIds = matchingSessions(sessions, (stat) => stat.rows.some((row) => row.suspected_bot));
  const lowSignalIds = matchingSessions(sessions, isLowSignal);
  const qualifiedIds = new Set([...sessions.keys()].filter((id) => !internalIds.has(id) && !botIds.has(id) && !lowSignalIds.has(id)));
  const qualified = rows.filter((row) => qualifiedIds.has(row.session_id));
  const views = qualified.filter((row) => row.event_type === "page_view");
  const clicks = qualified.filter((row) => row.event_type === "click");
  const totalDwell = qualified.filter((row) => row.event_type === "page_exit").reduce((sum, row) => sum + row.duration_seconds, 0);
  const funnel = [["有效访问", qualifiedIds.size], ["确认落地", uniqueSessions(qualified, "landing_confirmed")], ["打开设计器", uniqueSessions(qualified, "design_opened")], ["开始上传", uniqueSessions(qualified, "upload_started")], ["预览完成", uniqueSessions(qualified, "preview_ready")], ["打开配送", uniqueSessions(qualified, "delivery_opened")], ["跳转付款", uniqueSessions(qualified, "payment_redirected")], ["付款完成", uniqueSessions(qualified, "purchase_completed")]] as const;
  const qualifiedSessions = [...sessions.entries()].filter(([id]) => qualifiedIds.has(id));
  const deviceStats = aggregateSessionDimension(qualifiedSessions, (stat) => preferredDimension(stat.rows, "device_class", ["unknown"]));
  const referrerStats = aggregateSessionDimension(qualifiedSessions, (stat) => preferredDimension(stat.rows, "referrer_group", ["internal", "direct"]));
  const recentSessions = [...sessions.entries()].filter(([id]) => qualifiedIds.has(id)).sort((a, b) => b[1].lastSeen.localeCompare(a[1].lastSeen)).slice(0, 30);

  return <AppShell admin><main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
    <header><p className="text-xs font-black uppercase tracking-[0.18em] text-accent">用户行为分析</p><h1 className="mt-2 text-4xl font-black">有效访问与转化</h1><p className="mt-2 text-sm text-muted">最近 30 天 · 默认排除内部测试、已识别机器人及单页零交互低信号会话</p></header>
    {error ? <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">读取行为数据失败：{error.message}</p> : null}
    <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="有效匿名会话" value={qualifiedIds.size} /><Metric label="有效页面浏览" value={views.length} /><Metric label="有效点击 / 操作" value={clicks.length} /><Metric label="平均停留 / 有效会话" value={`${qualifiedIds.size ? Math.round(totalDwell / qualifiedIds.size) : 0} 秒`} /><Metric label="付款完成" value={uniqueSessions(qualified, "purchase_completed")} /></section>
    <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950"><h2 className="font-black">数据质量说明</h2><p className="mt-2 text-sm">原始会话 {sessions.size} 个；已排除内部测试 {internalIds.size} 个、已识别机器人 {botIds.size} 个、低信号 {lowSignalIds.size} 个。低信号指仅一次浏览、零停留、零点击且没有任何设计或结账事件；它可能包含爬虫和真实跳出，因此单独保留口径说明。</p><p className="mt-1 text-xs">访问链接加 <code>?internal_test=1</code> 可将该浏览器后续 30 天标记为内部测试；用 <code>?internal_test=0</code> 取消。</p></section>
    <section className="mt-6 rounded-xl border border-line bg-panel p-5"><h2 className="text-xl font-black">真人行为漏斗</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">{funnel.map(([label, value]) => <Funnel key={label} label={label} value={value} base={qualifiedIds.size} />)}</div></section>
    <section className="mt-6 grid gap-6 lg:grid-cols-2">
      <StatsTable title="有效页面表现" headers={["页面", "浏览次数", "独立会话"]} rows={aggregate(views, (row) => row.route).map(([key, count, unique]) => [routeLabels[key] ?? key, String(count), String(unique)])} />
      <StatsTable title="关键行为" headers={["行为", "发生次数", "独立会话"]} rows={aggregate(qualified.filter((row) => eventLabels[row.event_type]), (row) => row.event_type).map(([key, count, unique]) => [eventLabels[key as CustomerActivityEventType] ?? key, String(count), String(unique)])} />
      <StatsTable title="设备类型" headers={["设备", "有效会话"]} rows={deviceStats.map(([key, count]) => [deviceLabel(key), String(count)])} />
      <StatsTable title="来源分组" headers={["来源", "有效会话"]} rows={referrerStats.map(([key, count]) => [referrerLabel(key), String(count)])} />
    </section>
    <section className="mt-6 overflow-x-auto rounded-xl border border-line bg-panel p-5"><h2 className="text-xl font-black">最近有效匿名会话</h2><table className="mt-4 w-full min-w-[720px] text-left text-sm"><thead className="text-muted"><tr><th className="pb-3">会话</th><th>最近活动</th><th>页面</th><th>停留</th><th>点击</th><th>最深行为</th></tr></thead><tbody>{recentSessions.map(([id, stat]) => <tr className="border-t border-line" key={id}><td className="py-3 font-mono text-xs">{id.slice(0, 8)}…</td><td>{formatDate(stat.lastSeen)}</td><td>{[...stat.pages].map((path) => routeLabels[path] ?? path).join("、") || "—"}</td><td>{stat.seconds} 秒</td><td>{stat.clicks}</td><td>{deepestEvent(stat.rows)}</td></tr>)}</tbody></table>{!rows.length ? <p className="mt-4 text-sm text-muted">暂无行为记录。</p> : null}</section>
  </main></AppShell>;
}

function buildSessions(rows: ActivityRow[]) { const result = new Map<string, SessionStat>(); for (const row of [...rows].reverse()) { const stat = result.get(row.session_id) ?? { rows: [], pages: new Set<string>(), seconds: 0, clicks: 0, lastSeen: row.created_at }; stat.rows.push(row); stat.lastSeen = row.created_at; if (row.event_type === "page_view") stat.pages.add(row.route); if (row.event_type === "page_exit") stat.seconds += row.duration_seconds; if (row.event_type === "click") stat.clicks += 1; result.set(row.session_id, stat); } return result; }
function matchingSessions(sessions: Map<string, SessionStat>, predicate: (stat: SessionStat) => boolean) { return new Set([...sessions].filter(([, stat]) => predicate(stat)).map(([id]) => id)); }
function isLowSignal(stat: SessionStat) { return stat.rows.filter((row) => row.event_type === "page_view").length <= 1 && stat.seconds === 0 && stat.clicks === 0 && !stat.rows.some((row) => !["page_view", "page_exit"].includes(row.event_type)); }
function uniqueSessions(rows: ActivityRow[], type: CustomerActivityEventType) { return new Set(rows.filter((row) => row.event_type === type).map((row) => row.session_id)).size; }
function aggregate(rows: ActivityRow[], key: (row: ActivityRow) => string) { const map = new Map<string, { count: number; sessions: Set<string> }>(); for (const row of rows) { const k = key(row); const item = map.get(k) ?? { count: 0, sessions: new Set<string>() }; item.count += 1; item.sessions.add(row.session_id); map.set(k, item); } return [...map].map(([k, value]) => [k, value.count, value.sessions.size] as const).sort((a, b) => b[1] - a[1]); }
function aggregateSessionDimension(sessions: Array<[string, SessionStat]>, key: (stat: SessionStat) => string) { const map = new Map<string, number>(); for (const [, stat] of sessions) { const value = key(stat); map.set(value, (map.get(value) ?? 0) + 1); } return [...map].sort((a, b) => b[1] - a[1]); }
function preferredDimension<K extends "device_class" | "referrer_group">(rows: ActivityRow[], field: K, fallbackValues: string[]) { return rows.find((row) => !fallbackValues.includes(row[field]))?.[field] ?? rows.find((row) => fallbackValues.includes(row[field]))?.[field] ?? "unknown"; }
function deepestEvent(rows: ActivityRow[]) { const order: CustomerActivityEventType[] = ["purchase_completed", "payment_redirected", "checkout_started", "delivery_opened", "preview_ready", "upload_started", "design_opened", "landing_confirmed"]; const event = order.find((type) => rows.some((row) => row.event_type === type)); return event ? eventLabels[event] : "浏览"; }
function deviceLabel(value: string) { return ({ desktop: "桌面端", mobile: "手机", tablet: "平板", unknown: "未知" } as Record<string, string>)[value] ?? value; }
function referrerLabel(value: string) { return ({ direct: "直接访问", internal: "站内", search: "搜索引擎", x: "X / Twitter", other: "其他站点" } as Record<string, string>)[value] ?? value; }
function Metric({ label, value }: { label: string; value: number | string }) { return <article className="rounded-xl border border-line bg-panel p-4"><p className="text-sm text-muted">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></article>; }
function Funnel({ label, value, base }: { label: string; value: number; base: number }) { return <article className="rounded-lg bg-surface p-3"><p className="text-xs font-bold text-muted">{label}</p><p className="mt-2 text-2xl font-black">{value}</p><p className="text-xs text-muted">{base ? Math.round(value / base * 100) : 0}%</p></article>; }
function StatsTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) { return <div className="overflow-x-auto rounded-xl border border-line bg-panel p-5"><h2 className="text-xl font-black">{title}</h2><table className="mt-4 w-full min-w-[420px] text-left text-sm"><thead className="text-muted"><tr>{headers.map((header) => <th className="pb-3" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className="border-t border-line" key={`${row[0]}:${index}`}>{row.map((cell, cellIndex) => <td className="py-3" key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>{!rows.length ? <p className="mt-4 text-sm text-muted">暂无数据。</p> : null}</div>; }
function getThirtyDaysAgo() { const date = new Date(); date.setUTCDate(date.getUTCDate() - 30); return date.toISOString(); }
