import { randomUUID } from "node:crypto";
import type { getSupabaseServiceClient } from "@/lib/supabase/service";

type SupabaseService = NonNullable<ReturnType<typeof getSupabaseServiceClient>>;

type AlertConfig = {
  apiKey: string;
  from: string;
  to: string;
};

type PaymentTriggerAlertInput = {
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

type EmailMessage = {
  subject: string;
  text: string;
  html: string;
};

const ALERT_EXTERNAL_EVENT_ID = "notification:first-payment-trigger-email:v1";
const RESEND_IDEMPOTENCY_KEY = "thebestdiy-first-payment-trigger-email-v1";

export async function notifyFirstPaymentTrigger(
  input: PaymentTriggerAlertInput,
  runtime: AlertRuntime = {},
) {
  const production = runtime.production ?? process.env.VERCEL_ENV === "production";
  if (!production) {
    return { ok: true as const, status: "non-production" as const };
  }

  const config = runtime.config === undefined
    ? getPaymentTriggerAlertConfig()
    : runtime.config;
  if (!config) {
    return { ok: true as const, status: "not-configured" as const };
  }

  const { data: claim, error: claimError } = await input.supabase
    .from("order_status_events")
    .insert({
      order_id: input.orderId,
      status: "awaiting_payment",
      note: "First payment-trigger email delivery claimed.",
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
      error: claimError?.message ?? "Could not claim the first payment-trigger email.",
    };
  }

  const result = await sendEmail(
    config,
    buildFirstPaymentTriggerEmail(input),
    RESEND_IDEMPOTENCY_KEY,
    "first_payment_trigger",
    runtime.fetch,
  );

  if (!result.ok) {
    if (result.retrySafe) {
      await input.supabase
        .from("order_status_events")
        .delete()
        .eq("id", claim.id);
    }
    return { ok: false as const, error: result.error };
  }

  const { error: markSentError } = await input.supabase
    .from("order_status_events")
    .update({ note: `First payment-trigger email sent. Resend ID: ${result.emailId}` })
    .eq("id", claim.id);
  if (markSentError) {
    return { ok: false as const, error: markSentError.message };
  }

  return { ok: true as const, status: "sent" as const, emailId: result.emailId };
}

export async function sendPaymentTriggerTestEmail(runtime: AlertRuntime = {}) {
  const config = runtime.config === undefined
    ? getPaymentTriggerAlertConfig()
    : runtime.config;
  if (!config) {
    return { ok: true as const, status: "not-configured" as const };
  }

  const message: EmailMessage = {
    subject: "[测试] theBestDiy 付款触发通知",
    text: [
      "这是一封付款触发通知测试邮件。",
      "收到此邮件表示 Resend 发件配置和通知收件邮箱均已生效。",
      "真实通知会在用户成功创建 Stripe Checkout 或 PayPal 付款订单时发送。",
      "本邮件不代表真实订单，也不代表付款已完成。",
    ].join("\n"),
    html: "<h1>付款触发通知测试成功</h1><p>收到此邮件表示 Resend 发件配置和通知收件邮箱均已生效。</p><p>真实通知会在用户成功创建 Stripe Checkout 或 PayPal 付款订单时发送。</p><p><strong>本邮件不代表真实订单，也不代表付款已完成。</strong></p>",
  };

  const result = await sendEmail(
    config,
    message,
    `thebestdiy-payment-trigger-test-${randomUUID()}`,
    "payment_trigger_test",
    runtime.fetch,
  );
  if (!result.ok) {
    return { ok: false as const, error: result.error };
  }

  return { ok: true as const, status: "sent" as const, emailId: result.emailId };
}

export function buildFirstPaymentTriggerEmail({
  amountCents,
  currency,
  orderId,
  orderNumber,
  paymentProvider,
}: Omit<PaymentTriggerAlertInput, "supabase">): EmailMessage {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
  const adminUrl = `https://www.thebestdiyshop.com/admin/orders/${encodeURIComponent(orderId)}`;
  const provider = paymentProvider === "paypal" ? "PayPal" : "Stripe";
  const subject = `theBestDiy：首次触发付款（${amount}）`;
  const text = [
    "检测到用户已进入支付流程。",
    "这表示支付平台订单已创建，不代表付款已经完成。",
    `订单号：${orderNumber}`,
    `待付金额：${amount}`,
    `支付渠道：${provider}`,
    `查看订单：${adminUrl}`,
  ].join("\n");

  return {
    subject,
    text,
    html: `<h1>首次触发付款</h1><p>检测到用户已进入支付流程。</p><p><strong>这表示支付平台订单已创建，不代表付款已经完成。</strong></p><ul><li>订单号：${escapeHtml(orderNumber)}</li><li>待付金额：${escapeHtml(amount)}</li><li>支付渠道：${provider}</li></ul><p><a href="${adminUrl}">前往管理后台查看订单</a></p>`,
  };
}

function getPaymentTriggerAlertConfig(): AlertConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = (
    process.env.FIRST_PAYMENT_TRIGGER_EMAIL_FROM
    ?? process.env.FIRST_PURCHASE_EMAIL_FROM
  )?.trim();
  const to = process.env.FIRST_PAYMENT_TRIGGER_EMAIL_TO?.trim();
  if (!apiKey || !from || !to) return null;
  return { apiKey, from, to };
}

async function sendEmail(
  config: AlertConfig,
  message: EmailMessage,
  idempotencyKey: string,
  category: string,
  fetchOverride?: typeof fetch,
) {
  let response: Response;
  try {
    response = await (fetchOverride ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: config.from,
        to: [config.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: [{ name: "category", value: category }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return {
      ok: false as const,
      retrySafe: false,
      error: error instanceof Error ? error.message : "Email delivery is uncertain.",
    };
  }

  const payload = (await response.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
  };
  if (!response.ok || !payload.id) {
    return {
      ok: false as const,
      retrySafe: true,
      error: payload.message ?? `Resend rejected the email (${response.status}).`,
    };
  }

  return { ok: true as const, emailId: payload.id };
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
