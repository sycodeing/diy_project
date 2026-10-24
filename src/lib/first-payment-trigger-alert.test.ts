import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFirstPaymentTriggerEmail,
  notifyFirstPaymentTrigger,
  sendPaymentTriggerTestEmail,
} from "@/lib/first-payment-trigger-alert";

function createAlertClient() {
  let event: { id: string; note: string; status: string } | null = null;
  const client = {
    from(table: string) {
      assert.equal(table, "order_status_events");
      return {
        insert(values: { note: string; status: string }) {
          return {
            select() {
              return {
                async single() {
                  if (event) {
                    return { data: null, error: { code: "23505", message: "duplicate" } };
                  }
                  event = { id: "claim-1", note: values.note, status: values.status };
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
  } as unknown as Parameters<typeof notifyFirstPaymentTrigger>[0]["supabase"];
  return { client, getEvent: () => event };
}

test("builds a payment-trigger alert that does not claim payment completed", () => {
  const message = buildFirstPaymentTriggerEmail({
    amountCents: 1999,
    currency: "usd",
    orderId: "order-123",
    orderNumber: "DIY-TEST123",
    paymentProvider: "paypal",
  });

  assert.match(message.subject, /首次触发付款/);
  assert.match(message.subject, /\$19\.99/);
  assert.match(message.text, /DIY-TEST123/);
  assert.match(message.text, /PayPal/);
  assert.match(message.text, /不代表付款已经完成/);
  assert.match(message.text, /\/admin\/orders\/order-123/);
  assert.doesNotMatch(message.text, /customer|shipping|address/i);
});

test("escapes order labels before rendering HTML", () => {
  const message = buildFirstPaymentTriggerEmail({
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

test("claims and sends the first payment-trigger alert only once", async () => {
  const { client, getEvent } = createAlertClient();
  let fetchCalls = 0;
  const fetchMock: typeof fetch = async (_input, init) => {
    fetchCalls += 1;
    const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string };
    assert.deepEqual(body.to, ["1299078636@qq.com"]);
    assert.match(body.subject, /首次触发付款/);
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
      to: "1299078636@qq.com",
    },
    fetch: fetchMock,
    production: true,
  };

  assert.deepEqual(await notifyFirstPaymentTrigger(input, runtime), {
    ok: true,
    status: "sent",
    emailId: "email-1",
  });
  assert.deepEqual(await notifyFirstPaymentTrigger(input, runtime), {
    ok: true,
    status: "already-claimed",
  });
  assert.equal(fetchCalls, 1);
  assert.equal(getEvent()?.status, "awaiting_payment");
  assert.match(getEvent()?.note ?? "", /email sent/i);
});

test("sends a clearly labeled test email to the configured recipient", async () => {
  const fetchMock: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      to: string[];
      subject: string;
      text: string;
    };
    assert.deepEqual(body.to, ["1299078636@qq.com"]);
    assert.match(body.subject, /^\[测试\]/);
    assert.match(body.text, /不代表真实订单/);
    return new Response(JSON.stringify({ id: "email-test-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  assert.deepEqual(await sendPaymentTriggerTestEmail({
    config: {
      apiKey: "test-key",
      from: "theBestDiy <payments@thebestdiyshop.com>",
      to: "1299078636@qq.com",
    },
    fetch: fetchMock,
  }), {
    ok: true,
    status: "sent",
    emailId: "email-test-1",
  });
});
