import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripeConfig } from "@/lib/env";
import { notifyFirstPurchase } from "@/lib/first-purchase-alert";
import { createShippingFingerprint, normalizeShippingAddress } from "@/lib/shipping";
import { getStripeClient } from "@/lib/stripe";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { TEMU_PROCUREMENT_PRODUCT } from "@/lib/temu-procurement";
import type { ShippingAddress } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const stripe = getStripeClient();
  const supabase = getSupabaseServiceClient();
  const { webhookSecret } = getStripeConfig();

  if (!stripe || !supabase || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook is not configured." },
      { status: 503 },
    );
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.payment_status === "paid") {
      const result = await markOrderPaid({
        eventId: event.id,
        session,
        supabase,
      });

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
    }
  }

  if (event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;

    if (orderId) {
      await supabase
        .from("orders")
        .update({ payment_status: "failed", fulfillment_status: "awaiting_payment" })
        .eq("id", orderId);
    }
  }

  return NextResponse.json({ received: true });
}

async function markOrderPaid({
  eventId,
  session,
  supabase,
}: {
  eventId: string;
  session: Stripe.Checkout.Session;
  supabase: NonNullable<ReturnType<typeof getSupabaseServiceClient>>;
}) {
  const orderId = session.metadata?.order_id;

  if (!orderId) {
    return { ok: true as const };
  }

  const { data: order, error: orderReadError } = await supabase
    .from("orders")
    .select(
      "id,order_number,amount_cents,currency,shipping,paid_at,fulfillment_status,marketing_link_id,stripe_checkout_session_id",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (orderReadError || !order?.shipping) {
    return {
      ok: false as const,
      error: orderReadError?.message ?? "Paid order is missing its shipping address.",
    };
  }

  if (
    order.stripe_checkout_session_id !== session.id ||
    session.client_reference_id !== order.id ||
    session.currency?.toLowerCase() !== order.currency.toLowerCase() ||
    session.amount_subtotal !== order.amount_cents
  ) {
    return {
      ok: false as const,
      error: "Stripe Checkout Session does not match the stored order.",
    };
  }

  const shipping = normalizeShippingAddress(order.shipping as ShippingAddress);
  const paidAt = order.paid_at ?? new Date().toISOString();
  const { error: orderUpdateError } = await supabase
    .from("orders")
    .update({
      payment_status: "paid",
      fulfillment_status:
        order.fulfillment_status === "awaiting_payment"
          ? "ordered"
          : order.fulfillment_status,
      stripe_payment_intent_id: getStripeId(session.payment_intent),
      stripe_customer_id: getStripeId(session.customer),
      paid_at: paidAt,
      shipping,
    })
    .eq("id", orderId);

  if (orderUpdateError) {
    return { ok: false as const, error: orderUpdateError.message };
  }

  const { error: eventError } = await supabase
    .from("order_status_events")
    .upsert(
      {
        order_id: orderId,
        status: "ordered",
        note: "Payment confirmed. Temu purchase queued for the next payment batch.",
        external_event_id: eventId,
      },
      { onConflict: "external_event_id", ignoreDuplicates: true },
    );

  if (eventError) {
    return { ok: false as const, error: eventError.message };
  }

  const { error: jobError } = await supabase
    .from("temu_purchase_jobs")
    .upsert(
      {
        order_id: orderId,
        status: "ready_for_payment",
        product_url: TEMU_PROCUREMENT_PRODUCT.productUrl,
        goods_id: TEMU_PROCUREMENT_PRODUCT.goodsId,
        sku_id: null,
        expected_amount_cents: null,
        currency: TEMU_PROCUREMENT_PRODUCT.currency || order.currency,
        address_snapshot: shipping,
        address_fingerprint: createShippingFingerprint(shipping),
        idempotency_key: `temu-purchase:${orderId}`,
      },
      { onConflict: "order_id", ignoreDuplicates: true },
    );

  if (jobError) {
    return { ok: false as const, error: jobError.message };
  }

  if (order.marketing_link_id) {
    const { error: marketingError } = await supabase
      .from("marketing_events")
      .upsert(
        {
          marketing_link_id: order.marketing_link_id,
          event_type: "payment_completed",
          order_id: orderId,
          metadata: {
            stripeEventId: eventId,
            stripeCheckoutSessionId: session.id,
          },
        },
        { onConflict: "marketing_link_id,event_type", ignoreDuplicates: true },
      );
    if (marketingError) {
      return { ok: false as const, error: marketingError.message };
    }
  }

  const alert = await notifyFirstPurchase({
    amountCents: order.amount_cents,
    currency: order.currency,
    orderId: order.id,
    orderNumber: order.order_number,
    paymentProvider: "stripe",
    supabase,
  });
  if (!alert.ok) {
    console.error("First-purchase email could not be sent", {
      orderId: order.id,
      paymentProvider: "stripe",
      error: alert.error,
    });
  } else if (alert.status === "not-configured") {
    console.warn("First-purchase email is not configured");
  }

  return { ok: true as const };
}

function getStripeId(value: string | { id: string } | null) {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.id;
}
