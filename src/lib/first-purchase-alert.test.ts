import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFirstPurchaseEmail,
  notifyFirstPurchase,
} from "@/lib/first-purchase-alert";

function createAlertClient() {
  let event: { id: string; note: string } | null = null;
  const client = {
    from(table: string) {
      assert.equal(table, "order_status_events");
      return {
        insert(values: { note: string }) {
          return {
            select() {
              return {
                async single() {
                  if (event) {
                    return { data: null, error: { code: "23505", message: "duplicate" } };
                  }
                  event = { id: "claim-1", note: values.note };
                  return { data: { id: event.id }, error: null };
                },
              };
            },
          };
        },
        update(values: { note: string }) {
          return {
            async eq() {
              if (event) event.note = values.note;
              return { data: null, error: null };
            },
          };
        },
        delete() {
          return {
            async eq() {
              event = null;
              return { data: null, error: null };
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof notifyFirstPurchase>[0]["supabase"];
  return { client, getEvent: () => event };
}

test("builds a first-purchase alert without customer PII", () => {
  const message = buildFirstPurchaseEmail({
    amountCents: 1999,
    currency: "usd",
    orderId: "order-123",
    orderNumber: "DIY-TEST123",
    paymentProvider: "paypal",
  });

  assert.match(message.subject, /\$19\.99/);
  assert.match(message.text, /DIY-TEST123/);
  assert.match(message.text, /PayPal/);
  assert.match(message.text, /\/admin\/orders\/order-123/);
  assert.doesNotMatch(message.text, /customer|shipping|address/i);
});

test("escapes order labels before rendering HTML", () => {
  const message = buildFirstPurchaseEmail({
    amountCents: 100,
    currency: "usd",
    orderId: "order-123",
    orderNumber: "<script>alert(1)</script>",
    paymentProvider: "stripe",
  });

  assert.doesNotMatch(message.html, /<script>/);
  assert.match(message.html, /&lt;script&gt;/);
  assert.match(message.text, /Stripe/);
});

test("claims and sends the first-purchase alert only once", async () => {
  const { client, getEvent } = createAlertClient();
  let fetchCalls = 0;
  const fetchMock: typeof fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ id: "email-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const input = {
    amountCents: 1999,
    currency: "usd",
    orderId: "order-123",
    orderNumber: "DIY-TEST123",
    paymentProvider: "paypal" as const,
    supabase: client,
  };
  const runtime = {
    config: {
      apiKey: "test-key",
      from: "theBestDiy <payments@thebestdiyshop.com>",
      to: "sy980417@gmail.com",
    },
    fetch: fetchMock,
    production: true,
  };

  assert.deepEqual(await notifyFirstPurchase(input, runtime), {
    ok: true,
    status: "sent",
    emailId: "email-1",
  });
  assert.deepEqual(await notifyFirstPurchase(input, runtime), {
    ok: true,
    status: "already-claimed",
  });
  assert.equal(fetchCalls, 1);
  assert.match(getEvent()?.note ?? "", /email sent/i);
});
