"use client";

import {
  PRODUCT_CURRENCY,
  PRODUCT_PRICE_CENTS,
} from "@/lib/product-config";
import type { DesignPayload, OrderSummary, ShippingAddress } from "@/lib/types";
import { createOrderNumber } from "@/lib/utils";

export const MOCK_ORDERS_KEY = "studio-blank-mock-orders";

export type MockOrder = OrderSummary & {
  mock: true;
};

let cachedRaw: string | null = null;
let cachedOrders: MockOrder[] = [];

export function createMockOrder(
  design: DesignPayload,
  shipping: ShippingAddress,
  customerEmail?: string | null,
): MockOrder {
  const now = new Date().toISOString();

  return {
    id: `mock-${crypto.randomUUID()}`,
    mock: true,
    order_number: createOrderNumber(),
    amount_cents: PRODUCT_PRICE_CENTS,
    currency: PRODUCT_CURRENCY,
    customer_email: customerEmail ?? "debug-customer@example.com",
    payment_status: "paid",
    fulfillment_status: "production",
    sales_channel: "direct",
    temu_parent_order_sn: null,
    temu_order_sn: null,
    temu_status: "NOT_SUBMITTED",
    temu_status_label: "Mock order, not submitted to Temu",
    temu_last_synced_at: null,
    temu_raw: {
      mode: "mock",
      source: "browser-local-storage",
    },
    design_snapshot: design,
    shipping,
    created_at: now,
    updated_at: now,
  };
}

export function readMockOrders(): MockOrder[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(MOCK_ORDERS_KEY);

  if (!raw) {
    cachedRaw = null;
    cachedOrders = [];
    return [];
  }

  if (raw === cachedRaw) {
    return cachedOrders;
  }

  try {
    cachedRaw = raw;
    cachedOrders = JSON.parse(raw) as MockOrder[];
    return cachedOrders;
  } catch {
    window.localStorage.removeItem(MOCK_ORDERS_KEY);
    cachedRaw = null;
    cachedOrders = [];
    return [];
  }
}

export function saveMockOrder(order: MockOrder) {
  const orders = readMockOrders().filter((item) => item.id !== order.id);
  window.localStorage.setItem(
    MOCK_ORDERS_KEY,
    JSON.stringify([order, ...orders].slice(0, 25)),
  );
  window.dispatchEvent(new Event("studio-blank-mock-orders"));
}

export function findMockOrder(id: string) {
  return readMockOrders().find((order) => order.id === id) ?? null;
}
