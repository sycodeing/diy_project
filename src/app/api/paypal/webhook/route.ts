import { NextResponse } from "next/server";
import {
  capturePayPalOrder,
  getPayPalCapture,
  getPayPalOrder,
  verifyPayPalWebhook,
} from "@/lib/paypal";
import {
  applyPayPalLifecycleEvent,
  beginPayPalPaymentEvent,
  completePayPalPayment,
  findPayPalOrderForEvent,
  finishPayPalPaymentEvent,
} from "@/lib/paypal-payment";
import {
  parsePayPalWebhookEvent,
  type ParsedPayPalWebhookEvent,
} from "@/lib/paypal-webhook";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let rawEvent: Record<string, unknown>;
  try {
    rawEvent = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid webhook body." }, { status: 400 });
  }

  let signatureValid = false;
  try {
    signatureValid = await verifyPayPalWebhook(request, rawEvent);
  } catch {
    return NextResponse.json({ error: "Could not verify PayPal webhook." }, { status: 502 });
  }
  if (!signatureValid) {
    return NextResponse.json({ error: "Invalid PayPal signature." }, { status: 400 });
  }

  const event = parsePayPalWebhookEvent(rawEvent);
  if (!event) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Order storage is not configured." }, { status: 503 });
  }

  const linkedOrder = await findPayPalOrderForEvent(event, supabase);
  if (!linkedOrder.ok) {
    console.error("PayPal webhook could not look up its local order", {
      paypalEventId: event.eventId,
      eventType: event.eventType,
      error: linkedOrder.error,
    });
    return NextResponse.json({ error: "Could not look up PayPal order." }, { status: 500 });
  }
  if (!linkedOrder.order) {
    console.warn("Verified PayPal webhook is not linked to a local order", {
      paypalEventId: event.eventId,
      eventType: event.eventType,
      paypalOrderId: event.paypalOrderId,
      captureId: event.captureId,
      disputeId: event.disputeId,
    });
    return NextResponse.json({ received: true, unmatched: true });
  }

  const started = await beginPayPalPaymentEvent({
    event,
    orderId: linkedOrder.order.id,
    supabase,
  });
  if (!started.ok) {
    console.error("PayPal webhook audit could not start", {
      paypalEventId: event.eventId,
      error: started.error,
    });
    return NextResponse.json({ error: "Could not record PayPal event." }, { status: 500 });
  }
  if (!started.proceed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    if (event.eventType === "CHECKOUT.ORDER.APPROVED") {
      await processApprovedOrder(event, linkedOrder.order, supabase);
    } else if (event.eventType === "PAYMENT.CAPTURE.COMPLETED") {
      if (!event.paypalOrderId || !event.captureId || event.amountCents === null || !event.currency) {
        throw new Error("PayPal capture event is incomplete.");
      }
      const completed = await completePayPalPayment({
        amountCents: event.amountCents,
        captureId: event.captureId,
        currency: event.currency,
        paypalOrderId: event.paypalOrderId,
        supabase,
      });
      if (!completed.ok) throw new Error(completed.error);
    } else {
      const applied = await applyPayPalLifecycleEvent({
        event,
        orderId: linkedOrder.order.id,
        supabase,
      });
      if (!applied.ok) throw new Error(applied.error);
    }

    const finished = await finishPayPalPaymentEvent({
      eventId: event.eventId,
      supabase,
    });
    if (!finished.ok) throw new Error(finished.error);
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PayPal processing error.";
    const failed = await finishPayPalPaymentEvent({
      error: message,
      eventId: event.eventId,
      supabase,
    });
    console.error("PayPal webhook could not update its local order", {
      paypalEventId: event.eventId,
      eventType: event.eventType,
      error: message,
      auditError: failed.ok ? null : failed.error,
    });
    return NextResponse.json({ error: "Could not process PayPal event." }, { status: 500 });
  }
}

async function processApprovedOrder(
  event: ParsedPayPalWebhookEvent,
  order: { id: string; payment_status: string },
  supabase: NonNullable<ReturnType<typeof getSupabaseServiceClient>>,
) {
  if (!event.paypalOrderId) throw new Error("Approved PayPal order is incomplete.");
  if (["paid", "partially_refunded", "refunded", "reversed", "disputed"].includes(order.payment_status)) {
    return;
  }

  let capturedOrder;
  try {
    capturedOrder = await capturePayPalOrder(event.paypalOrderId, order.id);
  } catch (captureError) {
    // PayPal request IDs make capture idempotent, but an earlier successful
    // response can still be lost. Reconcile the order before asking PayPal to retry.
    try {
      capturedOrder = await getPayPalOrder(event.paypalOrderId);
    } catch {
      throw captureError;
    }
  }

  const capture = getPayPalCapture(capturedOrder);
  if (!capture) throw new Error("PayPal capture response is incomplete.");
  if (capture.status === "COMPLETED") {
    const completed = await completePayPalPayment({
      amountCents: capture.amountCents,
      captureId: capture.id,
      currency: capture.currency,
      paypalOrderId: event.paypalOrderId,
      supabase,
    });
    if (!completed.ok) throw new Error(completed.error);
    return;
  }
  if (capture.status !== "PENDING") {
    throw new Error(`PayPal capture returned ${capture.status}.`);
  }

  const pendingEvent: ParsedPayPalWebhookEvent = {
    ...event,
    eventType: "PAYMENT.CAPTURE.PENDING",
    resourceId: capture.id,
    resourceStatus: capture.status,
    captureId: capture.id,
    amountCents: capture.amountCents,
    currency: capture.currency,
  };
  const applied = await applyPayPalLifecycleEvent({
    event: pendingEvent,
    orderId: order.id,
    supabase,
  });
  if (!applied.ok) throw new Error(applied.error);
}
