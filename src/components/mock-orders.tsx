"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { DesignSummary } from "@/components/design-summary";
import { OrderStatus } from "@/components/order-status";
import { readMockOrders } from "@/lib/mock-orders";
import type { MockOrder } from "@/lib/mock-orders";
import { formatDate, formatMoney } from "@/lib/utils";
import type { ShippingAddress } from "@/lib/types";

const EMPTY_MOCK_ORDERS: MockOrder[] = [];

export function MockOrdersList({ showEmpty = true }: { showEmpty?: boolean }) {
  const orders = useMockOrders();

  if (!orders.length) {
    if (!showEmpty) return null;

    return (
      <div className="rounded-lg border border-line bg-panel/80 p-8 text-center">
        <p className="text-lg font-black">No mock orders yet.</p>
        <p className="mt-2 text-muted">
          Open a debug link, upload or replace the photo, then place a mock
          order.
        </p>
        <Link
          className="focus-ring mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-black text-accent-ink"
          href="/design"
        >
          Open DIY editor
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orders.map((order) => (
        <Link
          className="focus-ring block rounded-lg border border-line bg-panel/80 p-4 transition hover:border-accent/70"
          href={`/orders/${order.id}`}
          key={order.id}
        >
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-sm text-accent">
                {order.order_number}
              </p>
              <h2 className="mt-1 text-xl font-black">
                Mock Pillow photo proof
              </h2>
              <p className="mt-1 text-sm text-muted">
                Created {formatDate(order.created_at)}
              </p>
            </div>
            <p className="text-xl font-black">
              {formatMoney(order.amount_cents, order.currency)}
            </p>
          </div>
          <OrderStatus
            fulfillmentStatus={order.fulfillment_status}
            paymentStatus={order.payment_status}
            temuStatus={order.temu_status}
          />
        </Link>
      ))}
    </div>
  );
}

export function MockOrderDetail({ id }: { id: string }) {
  const orders = useMockOrders();
  const order = useMemo(
    () => orders.find((item) => item.id === id) ?? null,
    [id, orders],
  );

  if (!order) {
    return (
      <div className="rounded-lg border border-line bg-panel/85 p-8 text-center">
        <p className="text-lg font-black">Mock order not found.</p>
        <p className="mt-2 text-muted">
          Mock orders live in this browser only. Create another one from the DIY
          editor.
        </p>
        <Link
          className="focus-ring mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-black text-accent-ink"
          href="/design"
        >
          Open DIY editor
        </Link>
      </div>
    );
  }

  return (
    <>
      <section className="rounded-lg border border-line bg-panel/85 p-5">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-sm text-accent">
              {order.order_number}
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-normal">
              Mock Pillow order
            </h1>
            <p className="mt-2 text-sm text-muted">
              Created {formatDate(order.created_at)}
            </p>
          </div>
          <p className="text-2xl font-black">
            {formatMoney(order.amount_cents, order.currency)}
          </p>
        </div>

        <OrderStatus
          fulfillmentStatus={order.fulfillment_status}
          paymentStatus={order.payment_status}
          temuStatus={order.temu_status}
        />

        <div className="mt-5 rounded-lg border border-line bg-black p-4 text-sm">
          <p className="font-black">Mock checkout</p>
          <p className="mt-2 text-muted">
            This order was created locally for link, upload, and order-flow
            testing. No payment, Supabase write, or Temu sync happened.
          </p>
        </div>

        <div className="mt-6">
          <DesignSummary design={order.design_snapshot} />
        </div>

        <ShippingAddressSummary shipping={order.shipping} />
      </section>
    </>
  );
}

function ShippingAddressSummary({
  shipping,
}: {
  shipping: MockOrder["shipping"];
}) {
  if (!shipping || typeof shipping !== "object" || Array.isArray(shipping)) {
    return null;
  }

  const address = shipping as ShippingAddress;

  return (
    <div className="mt-6 border-t border-line pt-5">
      <h2 className="text-xl font-black">Delivery address</h2>
      <address className="mt-3 text-sm not-italic leading-6 text-muted">
        <span className="block font-bold text-foreground">{address.fullName}</span>
        <span className="block">{address.line1}</span>
        {address.line2 ? <span className="block">{address.line2}</span> : null}
        <span className="block">
          {address.city}, {address.region} {address.postalCode}
        </span>
        <span className="block">{address.country}</span>
        {address.phone ? <span className="block">{address.phone}</span> : null}
      </address>
    </div>
  );
}

function useMockOrders() {
  return useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("storage", onStoreChange);
      window.addEventListener("studio-blank-mock-orders", onStoreChange);

      return () => {
        window.removeEventListener("storage", onStoreChange);
        window.removeEventListener("studio-blank-mock-orders", onStoreChange);
      };
    },
    readMockOrders,
    () => EMPTY_MOCK_ORDERS,
  );
}
