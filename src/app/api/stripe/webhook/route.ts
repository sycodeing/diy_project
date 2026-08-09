import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripeConfig } from "@/lib/env";
import { getStripeClient } from "@/lib/stripe";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;

    if (orderId) {
      const sessionRecord = session as unknown as Record<string, unknown>;

      await supabase
        .from("orders")
        .update({
          payment_status: "paid",
          fulfillment_status: "production",
          stripe_payment_intent_id: getStripeId(session.payment_intent),
          stripe_customer_id: getStripeId(session.customer),
          shipping:
            sessionRecord.shipping_details ??
            sessionRecord.customer_details ??
            null,
        })
        .eq("id", orderId);

      await supabase.from("order_status_events").insert({
        order_id: orderId,
        status: "production",
        note: "Payment completed in Stripe Checkout.",
      });
    }
  }

  return NextResponse.json({ received: true });
}

function getStripeId(value: string | { id: string } | null) {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.id;
}
