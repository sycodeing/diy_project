import { createHash } from "node:crypto";
import { getPayPalConfig } from "@/lib/env";
import type { ShippingAddress } from "@/lib/types";

type PayPalLink = { href: string; rel: string };
type PayPalAmount = { currency_code: string; value: string };
export type PayPalCapture = {
  id?: string;
  status?: string;
  amount?: PayPalAmount;
  supplementary_data?: { related_ids?: { order_id?: string } };
};

export type PayPalOrderResponse = {
  id: string;
  status?: string;
  links?: PayPalLink[];
  purchase_units?: Array<{
    payments?: { captures?: PayPalCapture[] };
  }>;
};

async function getAccessToken() {
  const { clientId, clientSecret, environment } = getPayPalConfig();
  if (!clientId || !clientSecret) throw new Error("PayPal credentials are missing.");

  const response = await fetch(`${apiBase(environment)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const payload = (await response.json()) as { access_token?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error("PayPal authentication failed.");
  }
  return payload.access_token;
}

function apiBase(environment: "sandbox" | "live") {
  return environment === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function paypalFetch<T>(path: string, init: RequestInit = {}) {
  const { environment } = getPayPalConfig();
  const accessToken = await getAccessToken();
  const response = await fetch(`${apiBase(environment)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
  };
  if (!response.ok) {
    throw new Error(payload.message ?? `PayPal request failed (${response.status}).`);
  }
  return payload;
}

export async function createPayPalOrder({
  amountCents,
  appUrl,
  currency,
  orderId,
  orderNumber,
  productName,
  shipping,
}: {
  amountCents: number;
  appUrl: string;
  currency: string;
  orderId: string;
  orderNumber: string;
  productName: string;
  shipping: ShippingAddress;
}) {
  const payload = await paypalFetch<PayPalOrderResponse>("/v2/checkout/orders", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
      "PayPal-Request-Id": requestId(orderId, "c"),
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: orderId,
          custom_id: orderId,
          invoice_id: orderNumber,
          description: productName,
          amount: {
            currency_code: currency.toUpperCase(),
            value: (amountCents / 100).toFixed(2),
          },
          shipping: {
            name: { full_name: shipping.fullName },
            address: {
              address_line_1: shipping.line1,
              ...(shipping.line2 ? { address_line_2: shipping.line2 } : {}),
              admin_area_2: shipping.city,
              admin_area_1: shipping.region,
              postal_code: shipping.postalCode,
              country_code: shipping.country.toUpperCase(),
            },
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Studio Blank",
            user_action: "PAY_NOW",
            shipping_preference: "SET_PROVIDED_ADDRESS",
            return_url: `${appUrl}/api/paypal/return`,
            cancel_url: `${appUrl}/orders/${orderId}?payment=cancelled`,
          },
        },
      },
    }),
  });

  const approvalUrl = payload.links?.find((link) =>
    link.rel === "approve" || link.rel === "payer-action",
  )?.href;
  if (!payload.id || !approvalUrl) {
    throw new Error("PayPal did not return an approval link.");
  }
  return { id: payload.id, approvalUrl };
}

export async function capturePayPalOrder(paypalOrderId: string, orderId: string) {
  return paypalFetch<PayPalOrderResponse>(
    `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
    {
      method: "POST",
      headers: {
        Prefer: "return=representation",
        "PayPal-Request-Id": requestId(orderId, "p"),
      },
      body: "{}",
    },
  );
}

export async function verifyPayPalWebhook(
  request: Request,
  event: Record<string, unknown>,
) {
  const { webhookId } = getPayPalConfig();
  if (!webhookId) return false;

  const transmissionId = request.headers.get("paypal-transmission-id");
  const transmissionTime = request.headers.get("paypal-transmission-time");
  const certUrl = request.headers.get("paypal-cert-url");
  const authAlgo = request.headers.get("paypal-auth-algo");
  const transmissionSig = request.headers.get("paypal-transmission-sig");
  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return false;
  }

  const { environment } = getPayPalConfig();
  try {
    const certificateUrl = new URL(certUrl);
    const allowedHosts = environment === "live"
      ? new Set(["api.paypal.com", "api-m.paypal.com"])
      : new Set(["api.sandbox.paypal.com", "api-m.sandbox.paypal.com"]);
    if (
      certificateUrl.protocol !== "https:" ||
      !allowedHosts.has(certificateUrl.hostname) ||
      !certificateUrl.pathname.startsWith("/v1/notifications/certs/")
    ) {
      return false;
    }
  } catch {
    return false;
  }

  const result = await paypalFetch<{ verification_status?: string }>(
    "/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      body: JSON.stringify({
        transmission_id: transmissionId,
        transmission_time: transmissionTime,
        cert_url: certUrl,
        auth_algo: authAlgo,
        transmission_sig: transmissionSig,
        webhook_id: webhookId,
        webhook_event: event,
      }),
    },
  );
  return result.verification_status === "SUCCESS";
}

export function getCompletedCapture(order: PayPalOrderResponse) {
  return getCompletedPayPalCapture(order.purchase_units?.[0]?.payments?.captures?.[0]);
}

export function getCompletedPayPalCapture(capture?: PayPalCapture) {
  if (capture?.status !== "COMPLETED" || !capture.id || !capture.amount) return null;
  return {
    id: capture.id,
    currency: capture.amount.currency_code.toLowerCase(),
    amountCents: Math.round(Number(capture.amount.value) * 100),
  };
}

function requestId(orderId: string, purpose: "c" | "p") {
  const letters = createHash("sha256")
    .update(`${purpose}:${orderId}`)
    .digest("hex")
    .slice(0, 24)
    .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)));
  return `${purpose}${letters}`;
}
