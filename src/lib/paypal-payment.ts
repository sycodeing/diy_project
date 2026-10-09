import { createShippingFingerprint, normalizeShippingAddress } from "@/lib/shipping";
import { TEMU_PROCUREMENT_PRODUCT } from "@/lib/temu-procurement";
import type { ShippingAddress } from "@/lib/types";
import type { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function completePayPalPayment({
  amountCents,
  captureId,
  currency,
  eventId,
  paypalOrderId,
  supabase,
}: {
  amountCents: number;
  captureId: string;
  currency: string;
  eventId: string;
  paypalOrderId: string;
  supabase: NonNullable<ReturnType<typeof getSupabaseServiceClient>>;
}) {
  const { data: order, error: readError } = await supabase
    .from("orders")
    .select("id,order_number,amount_cents,currency,shipping,paid_at,fulfillment_status,payment_status,payment_provider,paypal_order_id,paypal_capture_id,marketing_link_id")
    .eq("paypal_order_id", paypalOrderId)
    .maybeSingle();

  if (readError || !order || !order.shipping) {
    return { ok: false as const, error: readError?.message ?? "PayPal order is not linked to a local order." };
  }
  if (
    order.payment_provider !== "paypal" ||
    order.paypal_order_id !== paypalOrderId ||
    order.amount_cents !== amountCents ||
    order.currency.toLowerCase() !== currency.toLowerCase() ||
    (order.paypal_capture_id && order.paypal_capture_id !== captureId)
  ) {
    return { ok: false as const, error: "PayPal capture does not match the stored order." };
  }

  const shipping = normalizeShippingAddress(order.shipping as ShippingAddress);
  const { error: orderUpdateError } = await supabase
    .from("orders")
    .update({
      payment_status: "paid",
      fulfillment_status:
        order.fulfillment_status === "awaiting_payment" ? "ordered" : order.fulfillment_status,
      paypal_capture_id: captureId,
      paid_at: order.paid_at ?? new Date().toISOString(),
      shipping,
    })
    .eq("id", order.id);

  if (orderUpdateError) return { ok: false as const, error: orderUpdateError.message };

  const { error: eventError } = await supabase.from("order_status_events").upsert(
    {
      order_id: order.id,
      status: "ordered",
      note: "PayPal payment confirmed. Temu purchase queued for the next payment batch.",
      external_event_id: `paypal:${eventId}`,
    },
    { onConflict: "external_event_id", ignoreDuplicates: true },
  );
  if (eventError) return { ok: false as const, error: eventError.message };

  const { error: jobError } = await supabase.from("temu_purchase_jobs").upsert(
    {
      order_id: order.id,
      status: "ready_for_payment",
      product_url: TEMU_PROCUREMENT_PRODUCT.productUrl,
      goods_id: TEMU_PROCUREMENT_PRODUCT.goodsId,
      sku_id: null,
      expected_amount_cents: null,
      currency: TEMU_PROCUREMENT_PRODUCT.currency || order.currency,
      address_snapshot: shipping,
      address_fingerprint: createShippingFingerprint(shipping),
      idempotency_key: `temu-purchase:${order.id}`,
    },
    { onConflict: "order_id", ignoreDuplicates: true },
  );
  if (jobError) return { ok: false as const, error: jobError.message };

  if (order.marketing_link_id) {
    const { error: marketingError } = await supabase.from("marketing_events").upsert(
      {
        marketing_link_id: order.marketing_link_id,
        event_type: "payment_completed",
        order_id: order.id,
        metadata: { paymentProvider: "paypal", paypalOrderId, paypalCaptureId: captureId },
      },
      { onConflict: "marketing_link_id,event_type", ignoreDuplicates: true },
    );
    if (marketingError) return { ok: false as const, error: marketingError.message };
  }

  return { ok: true as const, orderId: order.id, orderNumber: order.order_number };
}
