import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { OrderStatus } from "@/components/order-status";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TEMU_STATUS_OPTIONS } from "@/lib/temu";
import type { OrderSummary } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/utils";
import { updateOrderStatus } from "./actions";

const statusOptions = ["ordered", "production", "packing", "shipped"] as const;

export default async function AdminOrdersPage() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <AppShell>
        <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
          <SetupWarning />
        </main>
      </AppShell>
    );
  }

  await requireAdmin();

  const { data: orders } = await supabase
    .from("orders")
    .select(
      "id,order_number,amount_cents,currency,customer_email,payment_status,fulfillment_status,sales_channel,temu_parent_order_sn,temu_order_sn,temu_status,temu_status_label,temu_last_synced_at,temu_raw,design_snapshot,shipping,created_at,updated_at",
    )
    .order("created_at", { ascending: false });

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <div className="mb-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">
            Admin
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-normal">
            Temu order control
          </h1>
        </div>

        <div className="space-y-3">
          {(orders as OrderSummary[] | null)?.length ? (
            (orders as OrderSummary[]).map((order) => (
              <article
                className="rounded-lg border border-line bg-panel/85 p-4"
                key={order.id}
              >
                <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                  <div>
                    <Link
                      className="font-mono text-sm text-accent hover:text-foreground"
                      href={`/admin/orders/${order.id}`}
                    >
                      {order.order_number}
                    </Link>
                    <h2 className="mt-1 text-xl font-black">
                      {order.customer_email ?? "Unknown customer"}
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      {formatDate(order.created_at)} /{" "}
                      {formatMoney(order.amount_cents, order.currency)}
                    </p>
                    <div className="mt-4">
                      <OrderStatus
                        fulfillmentStatus={order.fulfillment_status}
                        paymentStatus={order.payment_status}
                        temuStatus={order.temu_status}
                      />
                    </div>
                  </div>

                  <form action={updateOrderStatus} className="space-y-3">
                    <input name="orderId" type="hidden" value={order.id} />
                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-muted">
                        Move status
                      </span>
                      <select
                        className="focus-ring h-11 w-full rounded-lg border border-line bg-black px-3 text-foreground"
                        defaultValue={order.fulfillment_status}
                        name="status"
                      >
                        {statusOptions.map((status) => (
                          <option key={status} value={status}>
                            {status.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-muted">
                        Temu status
                      </span>
                      <select
                        className="focus-ring h-11 w-full rounded-lg border border-line bg-black px-3 text-foreground"
                        defaultValue={order.temu_status}
                        name="temuStatus"
                      >
                        {TEMU_STATUS_OPTIONS.map((status) => (
                          <option key={status.value} value={status.value}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                      <label className="block">
                        <span className="mb-2 block text-sm font-bold text-muted">
                          Temu parent SN
                        </span>
                        <input
                          className="focus-ring h-11 w-full rounded-lg border border-line bg-black px-3 font-mono text-foreground placeholder:text-stone-600"
                          defaultValue={order.temu_parent_order_sn ?? ""}
                          name="temuParentOrderSn"
                          placeholder="parentOrderSn"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-bold text-muted">
                          Temu order SN
                        </span>
                        <input
                          className="focus-ring h-11 w-full rounded-lg border border-line bg-black px-3 font-mono text-foreground placeholder:text-stone-600"
                          defaultValue={order.temu_order_sn ?? ""}
                          name="temuOrderSn"
                          placeholder="orderSn"
                        />
                      </label>
                    </div>
                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-muted">
                        Note
                      </span>
                      <input
                        className="focus-ring h-11 w-full rounded-lg border border-line bg-black px-3 text-foreground placeholder:text-stone-600"
                        name="note"
                        placeholder="Optional production note"
                      />
                    </label>
                    <button
                      className="focus-ring h-11 w-full rounded-lg bg-accent px-4 font-black text-accent-ink transition hover:bg-foreground active:translate-y-px"
                      type="submit"
                    >
                      Update order
                    </button>
                  </form>
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-lg border border-line bg-panel/80 p-8 text-center">
              <p className="text-lg font-black">No orders yet.</p>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
