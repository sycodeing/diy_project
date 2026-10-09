import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { capturePayPalOrder, getCompletedCapture } from "@/lib/paypal";
import { completePayPalPayment } from "@/lib/paypal-payment";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const paypalOrderId = url.searchParams.get("token");
  if (!paypalOrderId) return NextResponse.redirect(new URL("/design?payment=cancelled", url));

  const supabase = await createSupabaseServerClient();
  const serviceSupabase = getSupabaseServiceClient();
  const { data: { user } } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  if (!user) {
    const next = `/api/paypal/return?token=${encodeURIComponent(paypalOrderId)}`;
    return NextResponse.redirect(new URL(`/auth?next=${encodeURIComponent(next)}`, url));
  }
  if (!serviceSupabase) return NextResponse.redirect(new URL("/orders", url));

  const { data: order } = await serviceSupabase
    .from("orders")
    .select("id,payment_status")
    .eq("paypal_order_id", paypalOrderId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!order) return NextResponse.redirect(new URL("/orders", url));
  if (order.payment_status === "paid") {
    return NextResponse.redirect(new URL(`/orders/${order.id}`, url));
  }

  try {
    const captureOrder = await capturePayPalOrder(paypalOrderId, order.id);
    const capture = getCompletedCapture(captureOrder);
    if (!capture) throw new Error("PayPal has not completed this capture.");

    const result = await completePayPalPayment({
      amountCents: capture.amountCents,
      captureId: capture.id,
      currency: capture.currency,
      eventId: `capture:${capture.id}`,
      paypalOrderId,
      supabase: serviceSupabase,
    });
    if (!result.ok) throw new Error(result.error);

    return NextResponse.redirect(new URL(`/orders/${order.id}`, url));
  } catch (error) {
    console.error("PayPal return capture could not be confirmed", {
      orderId: order.id,
      error: error instanceof Error ? error.message : "Unknown PayPal error",
    });
    const { data: refreshedOrder } = await serviceSupabase
      .from("orders")
      .select("payment_status")
      .eq("id", order.id)
      .maybeSingle();
    if (refreshedOrder?.payment_status === "paid") {
      return NextResponse.redirect(new URL(`/orders/${order.id}`, url));
    }
    return NextResponse.redirect(new URL(`/orders/${order.id}?payment=not-confirmed`, url));
  }
}
