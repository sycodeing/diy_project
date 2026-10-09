import { NextResponse } from "next/server";
import {
  PRODUCT_CURRENCY,
  PRODUCT_PRICE_CENTS,
  getOptionLabel,
  COLOR_OPTIONS,
  STYLE_OPTIONS,
} from "@/lib/product-config";
import { getAppUrl, getPayPalConfig, getStripeConfig } from "@/lib/env";
import { getStripeClient } from "@/lib/stripe";
import { createPayPalOrder } from "@/lib/paypal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { validateShippingAddress } from "@/lib/service-area";
import { checkoutRequestSchema } from "@/lib/validation";
import { createOrderNumber } from "@/lib/utils";
import {
  getActiveMarketingLinkFromCookie,
  recordMarketingEvent,
} from "@/lib/marketing";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const serviceSupabase = getSupabaseServiceClient();
  const stripe = getStripeClient();
  const paypalConfig = getPayPalConfig();

  if (!supabase || !serviceSupabase) {
    return NextResponse.json(
      { error: "Supabase environment variables are missing." },
      { status: 503 },
    );
  }

  const parsed = checkoutRequestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid design payload." }, { status: 400 });
  }

  const { design, shipping, paymentProvider } = parsed.data;
  if (paymentProvider === "stripe" && !stripe) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }
  if (paymentProvider === "paypal" && (!paypalConfig.clientId || !paypalConfig.clientSecret)) {
    return NextResponse.json({ error: "PayPal is not configured." }, { status: 503 });
  }
  if (paymentProvider === "paypal" && getStripeConfig().automaticTaxEnabled) {
    return NextResponse.json(
      { error: "PayPal checkout is unavailable while Stripe automatic tax is enabled." },
      { status: 503 },
    );
  }
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
    .select("id,name,category,description,base_price_cents,currency")
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
      payment_provider: paymentProvider,
      fulfillment_status: "awaiting_payment",
      sales_channel: "direct",
      temu_status: "NOT_SUBMITTED",
      temu_status_label: "Not submitted to Temu",
      design_snapshot: {
        ...design,
        productSnapshot: {
          slug: design.selection.productSlug,
          name: product.name,
          category: product.category,
          sku: variant.sku,
          quantity: 1,
          options: getProductOptions(design.selection),
        },
      },
      shipping,
      marketing_link_id: marketingLink?.id ?? null,
    })
    .select("id,order_number")
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Could not create order." }, { status: 500 });
  }

  const appUrl = getAppUrl(request.url);
  const { automaticTaxEnabled } = getStripeConfig();
  const productOptions = getProductOptions(design.selection);
  const productName = [product.name, ...Object.values(productOptions)].join(" / ");

  if (paymentProvider === "paypal") {
    try {
      const paypalOrder = await createPayPalOrder({
        amountCents,
        appUrl,
        currency,
        orderId: order.id,
        orderNumber: order.order_number,
        productName,
        shipping,
      });

      const { error: updateError } = await serviceSupabase
        .from("orders")
        .update({ paypal_order_id: paypalOrder.id })
        .eq("id", order.id)
        .eq("user_id", user.id);

      if (updateError) {
        console.error("PayPal order could not be linked to local order", { orderId: order.id });
        return NextResponse.json({ error: "Could not prepare PayPal payment." }, { status: 500 });
      }

      if (marketingLink) {
        const { error: marketingError } = await recordMarketingEvent(
          marketingLink.id,
          "checkout_started",
          { paymentProvider: "paypal", paypalOrderId: paypalOrder.id },
          order.id,
        );
        if (marketingError) {
          console.error("PayPal checkout attribution could not be recorded", { orderId: order.id });
        }
      }

      return NextResponse.json({ url: paypalOrder.approvalUrl });
    } catch (error) {
      console.error("PayPal order creation failed", {
        orderId: order.id,
        error: error instanceof Error ? error.message : "Unknown PayPal error",
      });
      return NextResponse.json({ error: "Could not prepare PayPal payment. Please try again." }, { status: 502 });
    }
  }

  const session = await stripe!.checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: order.id,
      customer_creation: "always",
      customer_email: user.email,
      automatic_tax: { enabled: automaticTaxEnabled },
      ...(automaticTaxEnabled
        ? { billing_address_collection: "required" as const }
        : {}),
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: productName,
              description: `${product.description ?? "Custom product"}. Order ${order.order_number}`,
              tax_code: "txcd_99999999",
            },
            tax_behavior: "exclusive",
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
    },
    { idempotencyKey: `checkout-session:${order.id}` },
  );

  const { data: updatedOrder, error: updateError } = await serviceSupabase
    .from("orders")
    .update({ stripe_checkout_session_id: session.id })
    .eq("id", order.id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (updateError || !updatedOrder || !session.url) {
    if (session.status === "open") {
      await stripe!.checkout.sessions.expire(session.id).catch(() => undefined);
    }
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
      console.error("Checkout attribution could not be recorded", {
        orderId: order.id,
        stripeCheckoutSessionId: session.id,
      });
    }
  }

  return NextResponse.json({ url: session.url });
}

function getProductOptions(selection: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(selection)
      .filter(([key]) => key !== "productSlug")
      .map(([key, value]) => {
        const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
        const displayValue = key === "color"
          ? getOptionLabel(COLOR_OPTIONS, value)
          : key === "style"
            ? getOptionLabel(STYLE_OPTIONS, value)
            : value;
        return [label, displayValue];
      }),
  );
}
