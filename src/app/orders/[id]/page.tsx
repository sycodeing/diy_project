import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DesignSummary } from "@/components/design-summary";
import { MockOrderDetail } from "@/components/mock-orders";
import { OrderStatus } from "@/components/order-status";
import { SetupWarning } from "@/components/setup-warning";
import { createDesignImageUrls } from "@/lib/design-images";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FulfillmentStatus, OrderSummary } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/utils";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (id.startsWith("mock-")) {
    return (
      <AppShell>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
          <Link
            className="text-sm font-bold text-muted hover:text-foreground"
            href="/orders"
          >
            Back to orders
          </Link>
          <div className="mt-5">
            <MockOrderDetail id={id} />
          </div>
        </main>
      </AppShell>
    );
  }

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth?next=/orders/${id}`);
  }

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id,order_number,amount_cents,currency,customer_email,payment_status,fulfillment_status,sales_channel,temu_parent_order_sn,temu_order_sn,temu_status,temu_status_label,temu_last_synced_at,temu_raw,design_snapshot,shipping,created_at,updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!order) {
    notFound();
  }

  const typedOrder = order as OrderSummary;
  const imageUrls = await createDesignImageUrls(
    supabase,
    typedOrder.design_snapshot,
  );
  const { data: events } = await supabase
    .from("order_status_events")
    .select("id,status,note,created_at")
    .eq("order_id", id)
    .order("created_at", { ascending: true });

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <Link className="text-sm font-bold text-muted hover:text-foreground" href="/orders">
          Back to orders
        </Link>

        <section className="mt-5 rounded-lg border border-line bg-panel/85 p-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-sm text-accent">
                {typedOrder.order_number}
              </p>
              <h1 className="mt-2 text-4xl font-black tracking-normal">
                Custom Pillow order
              </h1>
              <p className="mt-2 text-sm text-muted">
                Created {formatDate(typedOrder.created_at)}
              </p>
            </div>
            <p className="text-2xl font-black">
              {formatMoney(typedOrder.amount_cents, typedOrder.currency)}
            </p>
          </div>

          <OrderStatus
            fulfillmentStatus={typedOrder.fulfillment_status}
            paymentStatus={typedOrder.payment_status}
            temuStatus={typedOrder.temu_status}
          />

          <div className="mt-5 rounded-lg border border-line bg-black p-4 text-sm">
            <p className="font-black">Temu mirror</p>
            <dl className="mt-3 grid gap-2 text-muted sm:grid-cols-2">
              <div>
                <dt>Parent order SN</dt>
                <dd className="font-mono text-foreground">
                  {typedOrder.temu_parent_order_sn ?? "Not synced"}
                </dd>
              </div>
              <div>
                <dt>Order SN</dt>
                <dd className="font-mono text-foreground">
                  {typedOrder.temu_order_sn ?? "Not synced"}
                </dd>
              </div>
              <div>
                <dt>Channel</dt>
                <dd className="text-foreground">{typedOrder.sales_channel}</dd>
              </div>
              <div>
                <dt>Last sync</dt>
                <dd className="text-foreground">
                  {typedOrder.temu_last_synced_at
                    ? formatDate(typedOrder.temu_last_synced_at)
                    : "Temu data not available yet"}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted">
              Temu order data can be limited to marketplace status and order
              numbers; missing buyer or shipment fields stay in the local
              design/order snapshot.
            </p>
          </div>

          <div className="mt-6">
            <DesignSummary
              design={typedOrder.design_snapshot}
              imageUrls={imageUrls}
            />
          </div>
        </section>

        <section className="mt-5 rounded-lg border border-line bg-panel/85 p-5">
          <h2 className="mb-4 text-xl font-black">Status history</h2>
          <div className="space-y-3">
            {(events as
              | Array<{
                  id: string;
                  status: FulfillmentStatus;
                  note: string | null;
                  created_at: string;
                }>
              | null)?.length ? (
              (events as Array<{
                id: string;
                status: FulfillmentStatus;
                note: string | null;
                created_at: string;
              }>).map((event) => (
                <div
                  className="rounded-lg border border-line bg-black p-4 text-sm"
                  key={event.id}
                >
                  <p className="font-black capitalize">
                    {event.status.replaceAll("_", " ")}
                  </p>
                  <p className="mt-1 text-muted">{formatDate(event.created_at)}</p>
                  {event.note ? (
                    <p className="mt-2 text-foreground">{event.note}</p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">
                The first production event appears after payment succeeds.
              </p>
            )}
          </div>
        </section>
      </main>
    </AppShell>
  );
}
