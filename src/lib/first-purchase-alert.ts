import type { getSupabaseServiceClient } from "@/lib/supabase/service";

type SupabaseService = NonNullable<ReturnType<typeof getSupabaseServiceClient>>;

type AlertConfig = {
  apiKey: string;
  from: string;
  to: string;
};

type AlertInput = {
  amountCents: number;
  currency: string;
  orderId: string;
  orderNumber: string;
  paymentProvider: "paypal" | "stripe";
  supabase: SupabaseService;
};

type AlertRuntime = {
  config?: AlertConfig | null;
  fetch?: typeof fetch;
  production?: boolean;
};

const ALERT_EXTERNAL_EVENT_ID = "notification:first-paid-order-email:v1";
const ALERT_RECIPIENT = "sy980417@gmail.com";
const RESEND_IDEMPOTENCY_KEY = "thebestdiy-first-paid-order-email-v1";

export async function notifyFirstPurchase(
  input: AlertInput,
  runtime: AlertRuntime = {},
) {
  const production = runtime.production ?? process.env.VERCEL_ENV === "production";
  if (!production) {
    return { ok: true as const, status: "non-production" as const };
  }

  const config = runtime.config === undefined
    ? getFirstPurchaseAlertConfig()
    : runtime.config;
  if (!config) {
    return { ok: true as const, status: "not-configured" as const };
  }

  const { data: claim, error: claimError } = await input.supabase
    .from("order_status_events")
    .insert({
      order_id: input.orderId,
      status: "ordered",
      note: "First paid order email delivery claimed.",
      external_event_id: ALERT_EXTERNAL_EVENT_ID,
    })
    .select("id")
    .single();

  if (claimError?.code === "23505") {
    return { ok: true as const, status: "already-claimed" as const };
  }
  if (claimError || !claim) {
    return {
      ok: false as const,
      error: claimError?.message ?? "Could not claim the first-purchase email.",
    };
  }

  const message = buildFirstPurchaseEmail(input);
  let response: Response;
  try {
    response = await (runtime.fetch ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": RESEND_IDEMPOTENCY_KEY,
      },
      body: JSON.stringify({
        from: config.from,
        to: [config.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: [{ name: "category", value: "first_purchase" }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    // Delivery is uncertain after a network failure. Keep the unique claim so a
    // retry cannot send a duplicate message.
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Email delivery is uncertain.",
    };
  }

  const payload = (await response.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
  };
  if (!response.ok || !payload.id) {
    // A definite API rejection is safe to retry on the next payment callback.
    await input.supabase
      .from("order_status_events")
      .delete()
      .eq("id", claim.id);
    return {
      ok: false as const,
      error: payload.message ?? `Resend rejected the email (${response.status}).`,
    };
  }

  const { error: markSentError } = await input.supabase
    .from("order_status_events")
    .update({ note: `First paid order email sent. Resend ID: ${payload.id}` })
    .eq("id", claim.id);
  if (markSentError) {
    return { ok: false as const, error: markSentError.message };
  }

  return { ok: true as const, status: "sent" as const, emailId: payload.id };
}

export function buildFirstPurchaseEmail({
  amountCents,
  currency,
  orderId,
  orderNumber,
  paymentProvider,
}: Omit<AlertInput, "supabase">) {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
  const adminUrl = `https://www.thebestdiyshop.com/admin/orders/${encodeURIComponent(orderId)}`;
  const provider = paymentProvider === "paypal" ? "PayPal" : "Stripe";
  const subject = `theBestDiy received its first real payment (${amount})`;
  const text = [
    "The first production payment after launch was confirmed.",
    `Order: ${orderNumber}`,
    `Amount: ${amount}`,
    `Provider: ${provider}`,
    `Open order: ${adminUrl}`,
  ].join("\n");

  return {
    subject,
    text,
    html: `<h1>First real payment confirmed</h1><p>theBestDiy has received its first production payment.</p><ul><li>Order: ${escapeHtml(orderNumber)}</li><li>Amount: ${escapeHtml(amount)}</li><li>Provider: ${provider}</li></ul><p><a href="${adminUrl}">Open the order in the admin dashboard</a></p>`,
  };
}

function getFirstPurchaseAlertConfig(): AlertConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.FIRST_PURCHASE_EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from, to: ALERT_RECIPIENT };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}
