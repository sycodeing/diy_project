import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  await requireAdmin("/admin/marketing");
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const params = new URL(request.url).searchParams;
  let query = supabase.from("marketing_links").select("id,campaign,channel,variant,source_hash,click_count,created_at,expires_at,marketing_events(event_type,created_at),orders(order_number,amount_cents,currency,payment_status,paid_at)").order("created_at", { ascending: false }).limit(5000);
  if (params.get("from")) query = query.gte("created_at", `${params.get("from")}T00:00:00.000Z`);
  if (params.get("to")) query = query.lte("created_at", `${params.get("to")}T23:59:59.999Z`);
  for (const key of ["campaign", "channel", "variant"] as const) if (params.get(key)) query = query.eq(key, params.get(key));
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const header = ["link_id", "created_at", "campaign", "channel", "variant", "source_hash", "click_count", "events", "paid_orders", "revenue_cents"];
  const lines = [header, ...(data ?? []).map((row) => {
    const orders = row.orders ?? [];
    const paid = orders.filter((order) => order.payment_status === "paid");
    return [row.id, row.created_at, row.campaign, row.channel, row.variant, row.source_hash, row.click_count, (row.marketing_events ?? []).map((event) => event.event_type).join("|"), paid.length, paid.reduce((sum, order) => sum + order.amount_cents, 0)];
  })].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new NextResponse(`\uFEFF${lines}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="marketing-${new Date().toISOString().slice(0, 10)}.csv"` } });
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}
