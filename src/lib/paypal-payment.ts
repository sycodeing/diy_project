import { createShippingFingerprint, normalizeShippingAddress } from "@/lib/shipping";
import { TEMU_PROCUREMENT_PRODUCT } from "@/lib/temu-procurement";
import {
  nextPayPalPaymentStatus,
  payPalEventNote,
  requiresPaymentAttention,
  type ParsedPayPalWebhookEvent,
} from "@/lib/paypal-webhook";
import type { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { PaymentStatus, ShippingAddress } from "@/lib/types";

type SupabaseService = NonNullable<ReturnType<typeof getSupabaseServiceClient>>;

const ORDER_FIELDS = "id,order_number,amount_cents,currency,shipping,paid_at,fulfillment_status,payment_status,payment_provider,paypal_order_id,paypal_capture_id,paypal_dispute_id,paypal_refunded_amount_cents,payment_attention_required,marketing_link_id" as const;

const PAYMENT_REVIEW_STATUSES = new Set<PaymentStatus>([
  "partially_refunded",
  "refunded",
  "reversed",
  "disputed",
]);

export async function findPayPalOrderForEvent(
  event: ParsedPayPalWebhookEvent,
  supabase: SupabaseService,
) {
  const lookups = [
    ["paypal_order_id", event.paypalOrderId],
    ["paypal_capture_id", event.captureId],
    ["paypal_dispute_id", event.disputeId],
  ] as const;

  for (const [column, value] of lookups) {
    if (!value) continue;
    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_FIELDS)
      .eq(column, value)
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (data) return { ok: true as const, order: data };
  }

  return { ok: true as const, order: null };
}

export async function beginPayPalPaymentEvent({
  event,
  orderId,
  supabase,
}: {
  event: ParsedPayPalWebhookEvent;
  orderId: string;
  supabase: SupabaseService;
}) {
  const row = {
    order_id: orderId,
    paypal_event_id: event.eventId,
    event_type: event.eventType,
    resource_id: event.resourceId,
    resource_status: event.resourceStatus,
    paypal_order_id: event.paypalOrderId,
    paypal_capture_id: event.captureId,
    paypal_dispute_id: event.disputeId,
    amount_cents: event.amountCents,
    currency: event.currency,
    summary: event.summary,
    occurred_at: event.occurredAt,
    processing_status: "received",
    last_error: null,
    processed_at: null,
    event_metadata: event.disputeOutcome
      ? { disputeOutcome: event.disputeOutcome }
      : {},
  };
  const { data, error } = await supabase
    .from("paypal_payment_events")
    .insert(row)
    .select("id,processing_status,updated_at")
    .single();

  if (!error && data) return { ok: true as const, proceed: true as const };
  if (error?.code !== "23505") {
    return { ok: false as const, error: error?.message ?? "Could not record PayPal event." };
  }

  const { data: existing, error: existingError } = await supabase
    .from("paypal_payment_events")
    .select("id,processing_status,updated_at")
    .eq("paypal_event_id", event.eventId)
    .maybeSingle();
  if (existingError || !existing) {
    return { ok: false as const, error: existingError?.message ?? "Could not read PayPal event." };
  }
  if (existing.processing_status === "processed") {
    return { ok: true as const, proceed: false as const };
  }

  const updatedAt = Date.parse(existing.updated_at);
  const isStale = Number.isFinite(updatedAt) && Date.now() - updatedAt > 120_000;
  if (existing.processing_status === "received" && !isStale) {
    return { ok: true as const, proceed: false as const };
  }

  const { data: restarted, error: restartError } = await supabase
    .from("paypal_payment_events")
    .update({ ...row, order_id: orderId })
    .eq("id", existing.id)
    .select("id")
    .maybeSingle();
  if (restartError || !restarted) {
    return { ok: false as const, error: restartError?.message ?? "Could not retry PayPal event." };
  }
  return { ok: true as const, proceed: true as const };
}

export async function finishPayPalPaymentEvent({
  error,
  eventId,
  supabase,
}: {
  error?: string;
  eventId: string;
  supabase: SupabaseService;
}) {
  const { data, error: updateError } = await supabase
    .from("paypal_payment_events")
    .update({
      processing_status: error ? "failed" : "processed",
      last_error: error?.slice(0, 1_000) ?? null,
      processed_at: error ? null : new Date().toISOString(),
    })
    .eq("paypal_event_id", eventId)
    .select("id")
    .maybeSingle();
  if (updateError || !data) {
    return { ok: false as const, error: updateError?.message ?? "PayPal event audit row was not updated." };
  }
  return { ok: true as const };
}

export async function applyPayPalLifecycleEvent({
  event,
  orderId,
  supabase,
}: {
  event: ParsedPayPalWebhookEvent;
  orderId: string;
  supabase: SupabaseService;
}) {
  const { data: order, error: readError } = await supabase
    .from("orders")
    .select(ORDER_FIELDS)
    .eq("id", orderId)
    .maybeSingle();
  if (readError || !order) {
    return { ok: false as const, error: readError?.message ?? "PayPal order is not linked to a local order." };
  }
  if (order.payment_provider !== "paypal") {
    return { ok: false as const, error: "PayPal event is linked to a non-PayPal order." };
  }
  if (event.currency && order.currency.toLowerCase() !== event.currency.toLowerCase()) {
    return { ok: false as const, error: "PayPal event currency does not match the stored order." };
  }

  let refundedAmountCents = order.paypal_refunded_amount_cents ?? 0;
  if (event.eventType === "PAYMENT.CAPTURE.REFUNDED") {
    const { data: refunds, error: refundError } = await supabase
      .from("paypal_payment_events")
      .select("amount_cents")
      .eq("order_id", order.id)
      .eq("event_type", "PAYMENT.CAPTURE.REFUNDED")
      .in("processing_status", ["received", "processed"]);
    if (refundError) return { ok: false as const, error: refundError.message };
    refundedAmountCents = (refunds ?? []).reduce(
      (total, refund) => total + (refund.amount_cents ?? 0),
      0,
    );
  }

  const paymentStatus = nextPayPalPaymentStatus({
    current: order.payment_status as PaymentStatus,
    event,
    refundedAmountCents,
    orderAmountCents: order.amount_cents,
  });
  const update = {
    payment_status: paymentStatus,
    payment_attention_required: requiresPaymentAttention(paymentStatus, event),
    paypal_refunded_amount_cents: refundedAmountCents,
    ...(event.paypalOrderId && !order.paypal_order_id
      ? { paypal_order_id: event.paypalOrderId }
      : {}),
    ...(event.captureId && !order.paypal_capture_id
      ? { paypal_capture_id: event.captureId }
      : {}),
    ...(event.disputeId ? { paypal_dispute_id: event.disputeId } : {}),
  };
  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update(update)
    .eq("id", order.id)
    .select("id")
    .maybeSingle();
  if (updateError || !updated) {
    return { ok: false as const, error: updateError?.message ?? "PayPal order state was not updated." };
  }

  const { error: statusEventError } = await supabase.from("order_status_events").upsert(
    {
      order_id: order.id,
      status: order.fulfillment_status,
      note: payPalEventNote(event, paymentStatus),
      external_event_id: `paypal:${event.eventId}`,
    },
    { onConflict: "external_event_id", ignoreDuplicates: true },
  );
  if (statusEventError) return { ok: false as const, error: statusEventError.message };

  if (PAYMENT_REVIEW_STATUSES.has(paymentStatus)) {
    const { error: cancelError } = await supabase
      .from("temu_purchase_jobs")
      .update({
        status: "canceled",
        last_error_code: "paypal_payment_review",
        last_error_message: payPalEventNote(event, paymentStatus),
      })
      .eq("order_id", order.id)
      .in("status", ["configuration_required", "ready_for_payment", "failed"]);
    if (cancelError) return { ok: false as const, error: cancelError.message };
  }

  return { ok: true as const, orderId: order.id, paymentStatus };
}

export async function completePayPalPayment({
  amountCents,
  captureId,
  currency,
  paypalOrderId,
  supabase,
}: {
  amountCents: number;
  captureId: string;
  currency: string;
  paypalOrderId: string;
  supabase: SupabaseService;
}) {
  const { data: order, error: readError } = await supabase
    .from("orders")
    .select(ORDER_FIELDS)
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

  const currentStatus = order.payment_status as PaymentStatus;
  if (PAYMENT_REVIEW_STATUSES.has(currentStatus)) {
    return { ok: true as const, orderId: order.id, orderNumber: order.order_number };
  }

  const shipping = normalizeShippingAddress(order.shipping as ShippingAddress);
  const { data: updatedOrder, error: orderUpdateError } = await supabase
    .from("orders")
    .update({
      payment_status: "paid",
      payment_attention_required: false,
      fulfillment_status:
        order.fulfillment_status === "awaiting_payment" ? "ordered" : order.fulfillment_status,
      paypal_capture_id: captureId,
      paid_at: order.paid_at ?? new Date().toISOString(),
      shipping,
    })
    .eq("id", order.id)
    .select("id")
    .maybeSingle();

  if (orderUpdateError || !updatedOrder) {
    return { ok: false as const, error: orderUpdateError?.message ?? "Paid order was not updated." };
  }

  const { error: eventError } = await supabase.from("order_status_events").upsert(
    {
      order_id: order.id,
      status: "ordered",
      note: "PayPal payment confirmed. Temu purchase queued for the next payment batch.",
      external_event_id: `paypal:capture:${captureId}`,
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
