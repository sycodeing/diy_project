import type { PaymentStatus } from "@/lib/types";

export const PAYPAL_HANDLED_EVENT_TYPES = [
  "CHECKOUT.ORDER.APPROVED",
  "CHECKOUT.ORDER.COMPLETED",
  "CHECKOUT.ORDER.DECLINED",
  "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
] as const;

export type PayPalHandledEventType = (typeof PAYPAL_HANDLED_EVENT_TYPES)[number];

export type ParsedPayPalWebhookEvent = {
  eventId: string;
  eventType: PayPalHandledEventType;
  occurredAt: string | null;
  summary: string | null;
  resourceId: string | null;
  resourceStatus: string | null;
  paypalOrderId: string | null;
  captureId: string | null;
  disputeId: string | null;
  amountCents: number | null;
  currency: string | null;
  disputeOutcome: string | null;
};

const HANDLED_EVENT_TYPES = new Set<string>(PAYPAL_HANDLED_EVENT_TYPES);

export function parsePayPalWebhookEvent(
  event: Record<string, unknown>,
): ParsedPayPalWebhookEvent | null {
  const eventId = asString(event.id);
  const eventType = asString(event.event_type);
  if (!eventId || !eventType || !HANDLED_EVENT_TYPES.has(eventType)) return null;

  const resource = asRecord(event.resource);
  const relatedIds = asRecord(asRecord(resource?.supplementary_data)?.related_ids);
  const disputedTransaction = firstRecord(resource?.disputed_transactions);
  const amount = readAmount(
    eventType.startsWith("CUSTOMER.DISPUTE.")
      ? disputedTransaction?.seller_transaction_amount
      : resource?.amount,
  );

  const isCheckoutEvent = eventType.startsWith("CHECKOUT.");
  const isCaptureEvent = eventType.startsWith("PAYMENT.CAPTURE.");
  const isRefundEvent = eventType === "PAYMENT.CAPTURE.REFUNDED";

  return {
    eventId,
    eventType: eventType as PayPalHandledEventType,
    occurredAt: asString(event.create_time),
    summary: asString(event.summary),
    resourceId: asString(resource?.id),
    resourceStatus: asString(resource?.status),
    paypalOrderId:
      asString(relatedIds?.order_id) ??
      (isCheckoutEvent ? asString(resource?.id) : null),
    captureId:
      asString(relatedIds?.capture_id) ??
      (isCaptureEvent && !isRefundEvent ? asString(resource?.id) : null) ??
      asString(disputedTransaction?.seller_transaction_id),
    disputeId: eventType.startsWith("CUSTOMER.DISPUTE.")
      ? asString(resource?.dispute_id) ?? asString(resource?.id)
      : null,
    amountCents: amount?.amountCents ?? null,
    currency: amount?.currency ?? null,
    disputeOutcome: asString(asRecord(resource?.dispute_outcome)?.outcome_code),
  };
}

export function nextPayPalPaymentStatus({
  current,
  event,
  refundedAmountCents = 0,
  orderAmountCents = 0,
}: {
  current: PaymentStatus;
  event: ParsedPayPalWebhookEvent;
  refundedAmountCents?: number;
  orderAmountCents?: number;
}): PaymentStatus {
  switch (event.eventType) {
    case "PAYMENT.CAPTURE.PENDING":
      return canChangeUnpaidStatus(current) ? "payment_pending" : current;
    case "PAYMENT.CAPTURE.DENIED":
    case "CHECKOUT.ORDER.DECLINED":
      return canChangeUnpaidStatus(current) ? "failed" : current;
    case "CHECKOUT.PAYMENT-APPROVAL.REVERSED":
      return canChangeUnpaidStatus(current) ? "canceled" : current;
    case "PAYMENT.CAPTURE.COMPLETED":
      return current === "partially_refunded" ||
        current === "refunded" ||
        current === "reversed" ||
        current === "disputed"
        ? current
        : "paid";
    case "PAYMENT.CAPTURE.REFUNDED":
      return refundedAmountCents >= orderAmountCents ? "refunded" : "partially_refunded";
    case "PAYMENT.CAPTURE.REVERSED":
      return current === "refunded" ? current : "reversed";
    case "CUSTOMER.DISPUTE.CREATED":
    case "CUSTOMER.DISPUTE.UPDATED":
      return current === "refunded" || current === "reversed" ? current : "disputed";
    case "CUSTOMER.DISPUTE.RESOLVED":
      if (isSellerFavour(event.disputeOutcome)) {
        return current === "refunded" || current === "reversed" ? current : "paid";
      }
      if (isBuyerFavour(event.disputeOutcome)) return "reversed";
      return current;
    default:
      return current;
  }
}

export function requiresPaymentAttention(
  status: PaymentStatus,
  event?: ParsedPayPalWebhookEvent,
) {
  if (status === "partially_refunded" || status === "refunded" || status === "reversed") {
    return true;
  }
  if (status === "disputed") return true;
  if (event?.eventType === "CUSTOMER.DISPUTE.RESOLVED" && isSellerFavour(event.disputeOutcome)) {
    return false;
  }
  return false;
}

export function payPalEventNote(event: ParsedPayPalWebhookEvent, status: PaymentStatus) {
  const notes: Partial<Record<PayPalHandledEventType, string>> = {
    "CHECKOUT.ORDER.APPROVED": "PayPal buyer approved the checkout order.",
    "CHECKOUT.ORDER.COMPLETED": "PayPal checkout order completed.",
    "CHECKOUT.ORDER.DECLINED": "PayPal checkout order was declined.",
    "CHECKOUT.PAYMENT-APPROVAL.REVERSED": "PayPal reversed the buyer approval before capture.",
    "PAYMENT.CAPTURE.PENDING": "PayPal capture is pending; fulfillment remains blocked.",
    "PAYMENT.CAPTURE.COMPLETED": "PayPal capture completed.",
    "PAYMENT.CAPTURE.DENIED": "PayPal capture was denied.",
    "PAYMENT.CAPTURE.REFUNDED": status === "refunded"
      ? "PayPal payment was fully refunded."
      : "PayPal payment was partially refunded.",
    "PAYMENT.CAPTURE.REVERSED": "PayPal reversed the captured payment.",
    "CUSTOMER.DISPUTE.CREATED": "A PayPal customer dispute was opened.",
    "CUSTOMER.DISPUTE.UPDATED": "A PayPal customer dispute was updated.",
    "CUSTOMER.DISPUTE.RESOLVED": isSellerFavour(event.disputeOutcome)
      ? "PayPal resolved the dispute in the seller's favor."
      : isBuyerFavour(event.disputeOutcome)
        ? "PayPal resolved the dispute in the buyer's favor."
        : "PayPal resolved the customer dispute.",
  };
  return notes[event.eventType] ?? event.summary ?? `PayPal event ${event.eventType}.`;
}

function canChangeUnpaidStatus(status: PaymentStatus) {
  return status === "pending_payment" || status === "payment_pending" || status === "failed";
}

function isSellerFavour(outcome: string | null) {
  return outcome?.toUpperCase().includes("SELLER_FAVOUR") ?? false;
}

function isBuyerFavour(outcome: string | null) {
  return outcome?.toUpperCase().includes("BUYER_FAVOUR") ?? false;
}

function readAmount(value: unknown) {
  const amount = asRecord(value);
  const currency = asString(amount?.currency_code)?.toLowerCase();
  const numeric = Number(asString(amount?.value));
  if (!currency || !Number.isFinite(numeric) || numeric < 0) return null;
  return { amountCents: Math.round(numeric * 100), currency };
}

function firstRecord(value: unknown) {
  return Array.isArray(value) ? asRecord(value[0]) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
