import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { getAppUrl, getMarketingIngestSecret } from "@/lib/env";
import { MARKETING_CHANNEL_LABELS, MARKETING_STAGE_LABELS } from "@/lib/marketing-report";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET(request: Request) {
  await requireAdmin("/admin/marketing");
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const params = new URL(request.url).searchParams;
  let query = supabase.from("marketing_links").select("id,idempotency_key,campaign,channel,variant,source_lead_id,x_handle,x_post_id,x_post_url,lead_score,account_user_id,account_was_created,click_count,created_at,expires_at,marketing_events(event_type,created_at),orders(order_number,amount_cents,currency,payment_status,paid_at)").order("created_at", { ascending: false }).limit(5000);
  if (params.get("from")) query = query.gte("created_at", `${params.get("from")}T00:00:00.000Z`);
  if (params.get("to")) query = query.lte("created_at", `${params.get("to")}T23:59:59.999Z`);
  for (const key of ["campaign", "channel", "variant"] as const) if (params.get(key)) query = query.eq(key, params.get(key));
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  const accountIds = new Set(rows.flatMap((row) => row.account_user_id ? [row.account_user_id] : []));
  const accountEmailById = new Map<string, string>();
  const serviceSupabase = getSupabaseServiceClient();
  if (serviceSupabase && accountIds.size) {
    const { data: users } = await serviceSupabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const user of users?.users ?? []) {
      if (accountIds.has(user.id) && user.email) accountEmailById.set(user.id, user.email);
    }
  }
  const secret = getMarketingIngestSecret();
  const header = ["链接编号", "创建时间", "X线索编号", "X用户名", "X帖子编号", "X帖子地址", "线索评分", "专属链接", "活动", "触达渠道", "文案版本", "点击次数", "网站账号", "账号来源", "链路事件", "已付款订单数", "销售额（美分）"];
  const lines = [header, ...(data ?? []).map((row) => {
    const orders = row.orders ?? [];
    const paid = orders.filter((order) => order.payment_status === "paid");
    const url = secret ? `${getAppUrl()}/go/${createHmac("sha256", secret).update(`marketing-link:${row.idempotency_key}`).digest("base64url")}` : "";
    return [row.id, row.created_at, row.source_lead_id, row.x_handle ? `@${row.x_handle}` : "", row.x_post_id, row.x_post_url, row.lead_score, url, row.campaign, MARKETING_CHANNEL_LABELS[row.channel] ?? row.channel, row.variant, row.click_count, row.account_user_id ? accountEmailById.get(row.account_user_id) ?? row.account_user_id : "", row.account_user_id ? (row.account_was_created ? "由此链接新注册" : "已有账号登录") : "", (row.marketing_events ?? []).map((event) => MARKETING_STAGE_LABELS[event.event_type as keyof typeof MARKETING_STAGE_LABELS] ?? event.event_type).join("|"), paid.length, paid.reduce((sum, order) => sum + order.amount_cents, 0)];
  })].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new NextResponse(`\uFEFF${lines}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="marketing-${new Date().toISOString().slice(0, 10)}.csv"` } });
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}
