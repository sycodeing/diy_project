import assert from "node:assert/strict";
import test from "node:test";
import {
  claimPayPalCapture,
  releasePayPalCaptureClaim,
} from "@/lib/paypal-payment";

type TestOrder = {
  id: string;
  payment_provider: string;
  payment_status: string;
};

function createCaptureClaimClient(initialStatus: string) {
  const order: TestOrder = {
    id: "order-1",
    payment_provider: "paypal",
    payment_status: initialStatus,
  };

  return {
    order,
    client: {
      from(table: string) {
        assert.equal(table, "orders");
        return {
          update(values: Partial<TestOrder>) {
            const filters: Array<[keyof TestOrder, string]> = [];
            let applied = false;
            const apply = () => {
              if (applied) return { data: null, error: null };
              applied = true;
              const matches = filters.every(([column, value]) => order[column] === value);
              if (!matches) return { data: null, error: null };
              Object.assign(order, values);
              return { data: { id: order.id }, error: null };
            };
            const builder = {
              eq(column: keyof TestOrder, value: string) {
                filters.push([column, value]);
                return builder;
              },
              select() {
                return builder;
              },
              maybeSingle() {
                return Promise.resolve(apply());
              },
              then<TResult1 = { data: { id: string } | null; error: null }>(
                onfulfilled?: ((value: { data: { id: string } | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
              ) {
                return Promise.resolve(apply()).then(onfulfilled);
              },
            };
            return builder;
          },
        };
      },
    } as unknown as Parameters<typeof claimPayPalCapture>[0]["supabase"],
  };
}

test("only one concurrent path can claim a PayPal capture", async () => {
  const { client, order } = createCaptureClaimClient("pending_payment");

  const [first, second] = await Promise.all([
    claimPayPalCapture({ orderId: order.id, supabase: client }),
    claimPayPalCapture({ orderId: order.id, supabase: client }),
  ]);

  assert.deepEqual([first, second], [
    { ok: true, claimed: true },
    { ok: true, claimed: false },
  ]);
  assert.equal(order.payment_status, "payment_pending");
});

test("a released PayPal capture can be claimed again", async () => {
  const { client, order } = createCaptureClaimClient("pending_payment");
  assert.equal((await claimPayPalCapture({ orderId: order.id, supabase: client })).claimed, true);

  assert.equal((await releasePayPalCaptureClaim({ orderId: order.id, supabase: client })).ok, true);
  assert.equal(order.payment_status, "pending_payment");
  assert.equal((await claimPayPalCapture({ orderId: order.id, supabase: client })).claimed, true);
});

test("failed PayPal orders cannot be captured again automatically", async () => {
  const { client, order } = createCaptureClaimClient("failed");
  const result = await claimPayPalCapture({ orderId: order.id, supabase: client });

  assert.deepEqual(result, { ok: true, claimed: false });
  assert.equal(order.payment_status, "failed");
});
