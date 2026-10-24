import { createShippingFingerprint, normalizeShippingAddress } from "@/lib/shipping";
import { getProcurementJobStatus, resolveProductProcurement } from "@/lib/product-procurement";
import type { ShippingAddress } from "@/lib/types";
import type { getSupabaseServiceClient } from "@/lib/supabase/service";
import { recordCustomerActivity } from "@/lib/customer-activity";

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
    .select("id,order_number,amount_cents,currency,shipping,paid_at,fulfillment_status,payment_status,payment_provider,paypal_order_id,paypal_capture_id,marketing_link_id,activity_session_id,design_snapshot")
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
  const procurement = resolveProductProcurement(order.design_snapshot);
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
      status: getProcurementJobStatus(procurement),
      product_url: null,
      goods_id: procurement.goodsId,
      sku_id: procurement.skuId,
      quantity: procurement.quantity,
      expected_amount_cents: procurement.expectedAmountCents,
      currency: procurement.currency || order.currency,
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

  if (order.activity_session_id) {
    const { error: activityError } = await recordCustomerActivity({
      sessionId: order.activity_session_id,
      eventType: "purchase_completed",
      route: "/checkout/success",
      target: "paypal",
      eventKey: `purchase:${order.id}`,
      orderId: order.id,
    });
    if (activityError) console.error("PayPal purchase activity could not be recorded", { orderId: order.id, error: activityError.message });
  }

  return { ok: true as const, orderId: order.id, orderNumber: order.order_number };
}
