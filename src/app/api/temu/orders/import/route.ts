import { NextResponse } from "next/server";
import { getTemuSyncSecret } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  getTemuStatusLabel,
  mapTemuToFulfillmentStatus,
  normalizeTemuStatus,
} from "@/lib/temu";
import { temuOrderImportListSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const secret = getTemuSyncSecret();
  const supabase = getSupabaseServiceClient();
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!secret || !supabase) {
    return NextResponse.json(
      { error: "Temu sync is not configured." },
      { status: 503 },
    );
  }

  if (bearer !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const parsed = temuOrderImportListSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid Temu order payload." },
      { status: 400 },
    );
  }

  const results: Array<{
    parentOrderSn: string;
    matched: boolean;
    localOrderId?: string;
  }> = [];

  for (const incoming of parsed.data.orders) {
    const temuStatus = normalizeTemuStatus(incoming.status);
    const update: Record<string, unknown> = {
      sales_channel: "temu",
      temu_parent_order_sn: incoming.parentOrderSn,
      temu_order_sn: incoming.orderSn ?? null,
      temu_status: temuStatus,
      temu_status_label: getTemuStatusLabel(temuStatus),
      temu_last_synced_at: new Date().toISOString(),
      temu_raw: incoming.raw ?? incoming,
      fulfillment_status: mapTemuToFulfillmentStatus(temuStatus),
    };

    if (incoming.shipping) {
      update.shipping = incoming.shipping;
    }

    if (incoming.customerEmail) {
      update.customer_email = incoming.customerEmail;
    }

    const query = supabase
      .from("orders")
      .update(update)
      .select("id")
      .limit(1);

    const { data, error } = incoming.localOrderId
      ? await query.eq("id", incoming.localOrderId)
      : await query.eq("temu_parent_order_sn", incoming.parentOrderSn);

    const localOrderId = data?.[0]?.id;

    if (!error && localOrderId) {
      await supabase.from("order_status_events").insert({
        order_id: localOrderId,
        status: mapTemuToFulfillmentStatus(temuStatus),
        note: `Temu sync: ${getTemuStatusLabel(temuStatus)}.`,
      });
    }

    results.push({
      parentOrderSn: incoming.parentOrderSn,
      matched: Boolean(localOrderId),
      localOrderId,
    });
  }

  return NextResponse.json({ results });
}
