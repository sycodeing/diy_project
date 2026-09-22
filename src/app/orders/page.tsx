import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { MockOrdersList } from "@/components/mock-orders";
import { OrderStatus } from "@/components/order-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OrderSummary } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/utils";

export default async function OrdersPage() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <AppShell>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
          <OrdersHeader />
          <MockOrdersList />
        </main>
      </AppShell>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?next=/orders");
  }

  const { data: orders } = await supabase
    .from("orders")
    .select(
      "id,order_number,amount_cents,currency,customer_email,payment_status,fulfillment_status,sales_channel,temu_parent_order_sn,temu_order_sn,temu_status,temu_status_label,temu_last_synced_at,temu_raw,design_snapshot,shipping,created_at,updated_at",
    )
    .order("created_at", { ascending: false });

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <OrdersHeader />

        <div className="space-y-3">
          {(orders as OrderSummary[] | null)?.length ? (
            (orders as OrderSummary[]).map((order) => (
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
                      Custom Pillow photo proof
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      Ordered {formatDate(order.created_at)}
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
            ))
          ) : (
            <div className="rounded-lg border border-line bg-panel/80 p-8 text-center">
              <p className="text-lg font-black">No orders yet.</p>
              <p className="mt-2 text-muted">
                Build a pillow, check out, and the local order mirror will
                appear here.
              </p>
            </div>
          )}
        </div>

        <section className="mt-10 border-t border-line pt-6">
          <h2 className="mb-4 text-xl font-black">Local mock orders</h2>
          <MockOrdersList showEmpty={false} />
        </section>
      </main>
    </AppShell>
  );
}

function OrdersHeader() {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">
          Order archive
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-normal">
          Debug and Temu-linked orders
        </h1>
      </div>
      <Link
        className="focus-ring inline-flex h-11 items-center justify-center rounded-lg border border-line bg-white/5 px-4 text-sm font-bold text-foreground transition hover:bg-white/10"
        href="/design"
      >
        Start another design
      </Link>
    </div>
  );
}
