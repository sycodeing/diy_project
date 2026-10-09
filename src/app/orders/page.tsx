import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CustomerOrderStatus } from "@/components/order-status";
import { OrderProductSummary } from "@/components/order-product-summary";
import { SetupWarning } from "@/components/setup-warning";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OrderSummary } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/utils";

type CustomerOrder = Pick<
  OrderSummary,
  | "id"
  | "order_number"
  | "amount_cents"
  | "currency"
  | "payment_status"
  | "fulfillment_status"
  | "created_at"
  | "design_snapshot"
>;

export default async function OrdersPage() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <AppShell>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
          <OrdersHeader />
          <SetupWarning />
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
      "id,order_number,amount_cents,currency,payment_status,fulfillment_status,created_at,design_snapshot",
    )
    .order("created_at", { ascending: false });

  const productSlugs = [...new Set((orders ?? []).map((order) => order.design_snapshot?.selection?.productSlug).filter(Boolean))];
  const { data: products } = productSlugs.length
    ? await supabase.from("products").select("slug,name").in("slug", productSlugs)
    : { data: [] };
  const productNames = new Map((products ?? []).map((product) => [product.slug, product.name]));

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <OrdersHeader />

        <div className="space-y-3">
          {(orders as CustomerOrder[] | null)?.length ? (
            (orders as CustomerOrder[]).map((order) => (
              <Link
                className="focus-ring block rounded-xl border border-line bg-panel p-4 shadow-sm transition hover:border-accent/70 hover:shadow-md"
                href={`/orders/${order.id}`}
                key={order.id}
              >
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-mono text-sm text-accent">
                      {order.order_number}
                    </p>
                    <div className="mt-2">
                      <OrderProductSummary
                        design={order.design_snapshot}
                        fallbackName={productNames.get(order.design_snapshot.selection.productSlug) ?? "Product"}
                      />
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      Ordered {formatDate(order.created_at)}
                    </p>
                  </div>
                  <p className="text-xl font-black">
                    {formatMoney(order.amount_cents, order.currency)}
                  </p>
                </div>
                <CustomerOrderStatus
                  fulfillmentStatus={order.fulfillment_status}
                  paymentStatus={order.payment_status}
                />
              </Link>
            ))
          ) : (
            <div className="rounded-2xl border border-line bg-panel p-8 text-center">
              <p className="text-lg font-black">No orders yet.</p>
              <p className="mt-2 text-muted">
                Create your first custom pillow and it will appear here.
              </p>
              <Link className="focus-ring mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-accent px-5 font-bold text-accent-ink hover:bg-accent-strong" href="/design">Create your first design</Link>
            </div>
          )}
        </div>

      </main>
    </AppShell>
  );
}

function OrdersHeader() {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-4xl font-black tracking-tight">
          Your orders
        </h1>
      </div>
      <Link
        className="focus-ring inline-flex h-11 items-center justify-center rounded-lg border border-line bg-panel px-4 text-sm font-bold text-foreground transition hover:bg-surface"
        href="/design"
      >
        Start another design
      </Link>
    </div>
  );
}
