import { NextResponse } from "next/server";
import {
  PRODUCT_CURRENCY,
  PRODUCT_PRICE_CENTS,
  getOptionLabel,
  COLOR_OPTIONS,
  STYLE_OPTIONS,
} from "@/lib/product-config";
import { getAppUrl } from "@/lib/env";
import { getStripeClient } from "@/lib/stripe";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateShippingAddress } from "@/lib/service-area";
import { checkoutRequestSchema } from "@/lib/validation";
import { createOrderNumber } from "@/lib/utils";
import {
  getActiveMarketingLinkFromCookie,
  recordMarketingEvent,
} from "@/lib/marketing";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const stripe = getStripeClient();

  if (!supabase || !stripe) {
    return NextResponse.json(
      { error: "Supabase or Stripe environment variables are missing." },
      { status: 503 },
    );
  }

  const parsed = checkoutRequestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid design payload." }, { status: 400 });
  }

  const { design, shipping } = parsed.data;
  const shippingValidation = validateShippingAddress(shipping);

  if (!shippingValidation.ok) {
    return NextResponse.json(
      { error: shippingValidation.message },
      { status: 400 },
    );
  }

  for (const side of ["front", "back"] as const) {
    const sideDesign = design.sides[side];
    if (sideDesign.kind === "image" && !sideDesign.imagePath) {
      return NextResponse.json(
        { error: `Upload an image for the ${side} side before checkout.` },
        { status: 400 },
      );
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in before checkout." }, { status: 401 });
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id,name,base_price_cents,currency")
    .eq("slug", design.selection.productSlug)
    .single();

  if (productError || !product) {
    return NextResponse.json({ error: "Product is not configured." }, { status: 404 });
  }

  const { data: variant, error: variantError } = await supabase
    .from("product_variants")
    .select("id,sku,price_cents,currency")
    .eq("product_id", product.id)
    .eq("color", design.selection.color)
    .eq("style", design.selection.style)
    .eq("size", design.selection.size)
    .single();

  if (variantError || !variant) {
    return NextResponse.json({ error: "Selected variant is unavailable." }, { status: 404 });
  }

  const { data: customDesign, error: designError } = await supabase
    .from("custom_designs")
    .insert({
      user_id: user.id,
      product_id: product.id,
      variant_id: variant.id,
      configuration: design,
      status: "ordered",
    })
    .select("id")
    .single();

  if (designError || !customDesign) {
    return NextResponse.json({ error: "Could not save design." }, { status: 500 });
  }

  const amountCents = variant.price_cents ?? PRODUCT_PRICE_CENTS;
  const currency = variant.currency ?? PRODUCT_CURRENCY;
  const marketingLink = await getActiveMarketingLinkFromCookie();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      user_id: user.id,
      custom_design_id: customDesign.id,
      order_number: createOrderNumber(),
      customer_email: user.email,
      amount_cents: amountCents,
      currency,
      payment_status: "pending_payment",
      fulfillment_status: "awaiting_payment",
      sales_channel: "direct",
      temu_status: "NOT_SUBMITTED",
      temu_status_label: "Not submitted to Temu",
      design_snapshot: design,
      shipping,
      marketing_link_id: marketingLink?.id ?? null,
    })
    .select("id,order_number")
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Could not create order." }, { status: 500 });
  }

  const appUrl = getAppUrl();
  const productName = `${product.name} / ${getOptionLabel(
    COLOR_OPTIONS,
    design.selection.color,
  )} / ${getOptionLabel(STYLE_OPTIONS, design.selection.style)} / ${
    design.selection.size
  }`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: user.email,
    line_items: [
      {
        price_data: {
          currency,
          product_data: {
            name: productName,
            description: `Two custom 18in / 45cm pillow covers. Inserts not included. Order ${order.order_number}`,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      },
    ],
    metadata: {
      order_id: order.id,
      design_id: customDesign.id,
      user_id: user.id,
      ...(marketingLink ? { marketing_link_id: marketingLink.id } : {}),
    },
    success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/orders/${order.id}`,
  });

  const { error: updateError } = await supabase
    .from("orders")
    .update({ stripe_checkout_session_id: session.id })
    .eq("id", order.id);

  if (updateError || !session.url) {
    return NextResponse.json(
      { error: "Could not prepare payment session." },
      { status: 500 },
    );
  }

  if (marketingLink) {
    const { error: marketingError } = await recordMarketingEvent(
      marketingLink.id,
      "checkout_started",
      { stripeCheckoutSessionId: session.id },
      order.id,
    );
    if (marketingError) {
      return NextResponse.json(
        { error: "Checkout was created, but attribution could not be recorded." },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ url: session.url });
}
