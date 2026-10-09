import { NextResponse } from "next/server";
import {
  capturePayPalOrder,
  getCompletedCapture,
  getCompletedPayPalCapture,
  verifyPayPalWebhook,
  type PayPalCapture,
  type PayPalOrderResponse,
} from "@/lib/paypal";
import { completePayPalPayment } from "@/lib/paypal-payment";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let event: Record<string, unknown>;
  try {
    event = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid webhook body." }, { status: 400 });
  }

  let signatureValid = false;
  try {
    signatureValid = await verifyPayPalWebhook(request, event);
  } catch {
    return NextResponse.json({ error: "Could not verify PayPal webhook." }, { status: 502 });
  }
  if (!signatureValid) return NextResponse.json({ error: "Invalid PayPal signature." }, { status: 400 });

  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Order storage is not configured." }, { status: 503 });

  // Capture from the server as soon as PayPal reports buyer approval. This
  // makes completion independent of whether the browser can reach return_url.
  if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
    const approvedOrder = event.resource as PayPalOrderResponse | undefined;
    const paypalOrderId = typeof approvedOrder?.id === "string" ? approvedOrder.id : null;
    if (!paypalOrderId) return NextResponse.json({ error: "Approved PayPal order is incomplete." }, { status: 400 });

    const { data: order, error } = await supabase
      .from("orders")
      .select("id,payment_status")
      .eq("paypal_order_id", paypalOrderId)
      .maybeSingle();
    if (error || !order) {
      console.error("Approved PayPal order is not linked to a local order", { paypalOrderId, error: error?.message });
      return NextResponse.json({ error: "Approved PayPal order is not linked to an order." }, { status: 503 });
    }
    if (order.payment_status === "paid") return NextResponse.json({ received: true });

    try {
      const capturedOrder = await capturePayPalOrder(paypalOrderId, order.id);
      const capture = getCompletedCapture(capturedOrder);
      if (!capture) throw new Error("PayPal capture is not completed.");

      const result = await completePayPalPayment({
        amountCents: capture.amountCents,
        captureId: capture.id,
        currency: capture.currency,
        eventId: `capture:${capture.id}`,
        paypalOrderId,
        supabase,
      });
      if (!result.ok) throw new Error(result.error);
      return NextResponse.json({ received: true, captured: true });
    } catch (error) {
      console.error("PayPal approval webhook could not capture the order", {
        paypalOrderId,
        error: error instanceof Error ? error.message : "Unknown PayPal error",
      });
      return NextResponse.json({ error: "Could not capture approved PayPal order." }, { status: 500 });
    }
  }

  if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
    return NextResponse.json({ received: true });
  }

  const resource = event.resource as PayPalCapture | undefined;
  const capture = getCompletedPayPalCapture(resource);
  const paypalOrderId = resource?.supplementary_data?.related_ids?.order_id;
  const eventId = typeof event.id === "string" ? event.id : null;
  if (!capture || !paypalOrderId || !eventId) {
    return NextResponse.json({ error: "PayPal capture event is incomplete." }, { status: 400 });
  }

  const result = await completePayPalPayment({
    amountCents: capture.amountCents,
    captureId: capture.id,
    currency: capture.currency,
    eventId: `capture:${capture.id}`,
    paypalOrderId,
    supabase,
  });
  if (!result.ok) {
    console.error("PayPal payment webhook could not update the order", {
      paypalOrderId,
      paypalEventId: eventId,
      error: result.error,
    });
    return NextResponse.json({ error: "Could not update paid order." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
