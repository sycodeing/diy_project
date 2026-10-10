import assert from "node:assert/strict";
import test from "node:test";
import {
  PAYPAL_HANDLED_EVENT_TYPES,
  nextPayPalPaymentStatus,
  parsePayPalWebhookEvent,
  requiresPaymentAttention,
} from "./paypal-webhook.ts";

test("accepts every configured one-time checkout lifecycle event", () => {
  for (const eventType of PAYPAL_HANDLED_EVENT_TYPES) {
    const event = parsePayPalWebhookEvent({
      id: `WH-${eventType}`,
      event_type: eventType,
      resource: { id: "RESOURCE-1" },
    });
    assert.equal(event?.eventType, eventType);
  }
});

test("parses capture and refund correlation identifiers", () => {
  const completed = parsePayPalWebhookEvent({
    id: "WH-completed",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAPTURE-1",
      status: "COMPLETED",
      amount: { value: "19.99", currency_code: "USD" },
      supplementary_data: { related_ids: { order_id: "ORDER-1" } },
    },
  });
  assert.equal(completed?.paypalOrderId, "ORDER-1");
  assert.equal(completed?.captureId, "CAPTURE-1");
  assert.equal(completed?.amountCents, 1999);

  const refunded = parsePayPalWebhookEvent({
    id: "WH-refund",
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource: {
      id: "REFUND-1",
      amount: { value: "5.00", currency_code: "USD" },
      supplementary_data: { related_ids: { capture_id: "CAPTURE-1" } },
    },
  });
  assert.equal(refunded?.captureId, "CAPTURE-1");
  assert.equal(refunded?.resourceId, "REFUND-1");
  assert.equal(refunded?.amountCents, 500);
});

test("parses dispute correlation and outcome", () => {
  const event = parsePayPalWebhookEvent({
    id: "WH-dispute",
    event_type: "CUSTOMER.DISPUTE.RESOLVED",
    resource: {
      dispute_id: "PP-D-1",
      status: "RESOLVED",
      dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR" },
      disputed_transactions: [
        {
          seller_transaction_id: "CAPTURE-1",
          seller_transaction_amount: { value: "19.99", currency_code: "USD" },
        },
      ],
    },
  });
  assert.equal(event?.captureId, "CAPTURE-1");
  assert.equal(event?.disputeId, "PP-D-1");
  assert.equal(event?.disputeOutcome, "RESOLVED_SELLER_FAVOUR");
});

test("parses approval reversal order IDs from PayPal's resource.order_id shape", () => {
  const event = parsePayPalWebhookEvent({
    id: "WH-approval-reversed",
    event_type: "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
    resource: {
      order_id: "ORDER-REVERSED-1",
      purchase_units: [{ custom_id: "LOCAL-ORDER-1" }],
    },
  });
  assert.equal(event?.paypalOrderId, "ORDER-REVERSED-1");
  assert.equal(
    nextPayPalPaymentStatus({ current: "pending_payment", event: event! }),
    "canceled",
  );
});

test("maps payment failures, reversals, and disputes to safe fulfillment states", () => {
  const cases = [
    ["PAYMENT.CAPTURE.PENDING", "payment_pending", false],
    ["PAYMENT.CAPTURE.DENIED", "failed", false],
    ["CHECKOUT.ORDER.DECLINED", "failed", false],
    ["CHECKOUT.PAYMENT-APPROVAL.REVERSED", "canceled", false],
    ["PAYMENT.CAPTURE.REVERSED", "reversed", true],
    ["CUSTOMER.DISPUTE.CREATED", "disputed", true],
    ["CUSTOMER.DISPUTE.UPDATED", "disputed", true],
  ] as const;

  for (const [eventType, expectedStatus, attentionRequired] of cases) {
    const event = parsePayPalWebhookEvent({
      id: `WH-${eventType}`,
      event_type: eventType,
      resource: { id: "RESOURCE-1" },
    });
    assert.ok(event);
    const status = nextPayPalPaymentStatus({ current: "pending_payment", event });
    assert.equal(status, expectedStatus);
    assert.equal(requiresPaymentAttention(status, event), attentionRequired);
  }
});

test("resolves buyer-favor disputes as reversed and keeps fulfillment blocked", () => {
  const event = parsePayPalWebhookEvent({
    id: "WH-resolved-buyer",
    event_type: "CUSTOMER.DISPUTE.RESOLVED",
    resource: { dispute_outcome: { outcome_code: "RESOLVED_BUYER_FAVOUR" } },
  });
  assert.ok(event);
  const status = nextPayPalPaymentStatus({ current: "disputed", event });
  assert.equal(status, "reversed");
  assert.equal(requiresPaymentAttention(status, event), true);
});

test("does not downgrade paid orders for late pending or denied events", () => {
  for (const eventType of ["PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.DENIED"] as const) {
    const event = parsePayPalWebhookEvent({ id: `WH-${eventType}`, event_type: eventType, resource: {} });
    assert.ok(event);
    assert.equal(nextPayPalPaymentStatus({ current: "paid", event }), "paid");
  }
});

test("late completion cannot erase a refund or dispute", () => {
  const event = parsePayPalWebhookEvent({
    id: "WH-COMPLETED-LATE",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAPTURE-1",
      status: "COMPLETED",
      amount: { currency_code: "USD", value: "19.99" },
      supplementary_data: { related_ids: { order_id: "ORDER-1" } },
    },
  });
  assert.ok(event);
  assert.equal(nextPayPalPaymentStatus({ current: "partially_refunded", event }), "partially_refunded");
  assert.equal(nextPayPalPaymentStatus({ current: "disputed", event }), "disputed");
});

test("tracks partial and full cumulative refunds", () => {
  const event = parsePayPalWebhookEvent({
    id: "WH-refund",
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource: { amount: { value: "5.00", currency_code: "USD" } },
  });
  assert.ok(event);
  assert.equal(
    nextPayPalPaymentStatus({ current: "paid", event, refundedAmountCents: 500, orderAmountCents: 1999 }),
    "partially_refunded",
  );
  assert.equal(
    nextPayPalPaymentStatus({ current: "partially_refunded", event, refundedAmountCents: 1999, orderAmountCents: 1999 }),
    "refunded",
  );
});

test("resolves disputes without reviving already refunded orders", () => {
  const event = parsePayPalWebhookEvent({
    id: "WH-resolved",
    event_type: "CUSTOMER.DISPUTE.RESOLVED",
    resource: { dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR" } },
  });
  assert.ok(event);
  assert.equal(nextPayPalPaymentStatus({ current: "disputed", event }), "paid");
  assert.equal(nextPayPalPaymentStatus({ current: "refunded", event }), "refunded");
});

test("ignores unrelated PayPal products", () => {
  assert.equal(
    parsePayPalWebhookEvent({ id: "WH-subscription", event_type: "BILLING.SUBSCRIPTION.CREATED" }),
    null,
  );
});
