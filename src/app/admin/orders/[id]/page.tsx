import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DesignSummary } from "@/components/design-summary";
import { OrderStatus } from "@/components/order-status";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { createDesignImageUrls } from "@/lib/design-images";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TEMU_STATUS_OPTIONS } from "@/lib/temu";
import type { FulfillmentStatus, OrderSummary } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/utils";
import { updateOrderStatus } from "../actions";

const statusOptions = ["production", "packing", "shipped"] as const;

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
        <Link
          className="text-sm font-bold text-muted hover:text-foreground"
          href="/admin/orders"
        >
          Back to admin orders
        </Link>

        <section className="mt-5 rounded-lg border border-line bg-panel/85 p-5">
          <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
            <div>
              <p className="font-mono text-sm text-accent">
                {typedOrder.order_number}
              </p>
              <h1 className="mt-2 text-4xl font-black tracking-normal">
                {typedOrder.customer_email ?? "Unknown customer"}
              </h1>
              <p className="mt-2 text-sm text-muted">
                {formatDate(typedOrder.created_at)} /{" "}
                {formatMoney(typedOrder.amount_cents, typedOrder.currency)}
              </p>
            </div>

            <form action={updateOrderStatus} className="space-y-3">
              <input name="orderId" type="hidden" value={typedOrder.id} />
              <select
                className="focus-ring h-11 w-full rounded-lg border border-line bg-black px-3 text-foreground"
                defaultValue={typedOrder.fulfillment_status}
                name="status"
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              <select
                className="focus-ring h-11 w-full rounded-lg border border-line bg-black px-3 text-foreground"
                defaultValue={typedOrder.temu_status}
                name="temuStatus"
              >
                {TEMU_STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
              <input
                className="focus-ring h-11 w-full rounded-lg border border-line bg-black px-3 font-mono text-foreground placeholder:text-stone-600"
                defaultValue={typedOrder.temu_parent_order_sn ?? ""}
                name="temuParentOrderSn"
                placeholder="Temu parentOrderSn"
              />
              <input
                className="focus-ring h-11 w-full rounded-lg border border-line bg-black px-3 font-mono text-foreground placeholder:text-stone-600"
                defaultValue={typedOrder.temu_order_sn ?? ""}
                name="temuOrderSn"
                placeholder="Temu orderSn"
              />
              <input
                className="focus-ring h-11 w-full rounded-lg border border-line bg-black px-3 text-foreground placeholder:text-stone-600"
                name="note"
                placeholder="Optional production note"
              />
              <button
                className="focus-ring h-11 w-full rounded-lg bg-accent px-4 font-black text-accent-ink transition hover:bg-foreground active:translate-y-px"
                type="submit"
              >
                Update order
              </button>
            </form>
          </div>

          <div className="mt-6">
            <OrderStatus
              fulfillmentStatus={typedOrder.fulfillment_status}
              paymentStatus={typedOrder.payment_status}
              temuStatus={typedOrder.temu_status}
            />
          </div>
        </section>

        <section className="mt-5 rounded-lg border border-line bg-panel/85 p-5">
          <h2 className="mb-4 text-xl font-black">Temu mirror</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-black p-4">
              <dt className="text-muted">Parent order SN</dt>
              <dd className="mt-1 font-mono text-foreground">
                {typedOrder.temu_parent_order_sn ?? "Not synced"}
              </dd>
            </div>
            <div className="rounded-lg border border-line bg-black p-4">
              <dt className="text-muted">Order SN</dt>
              <dd className="mt-1 font-mono text-foreground">
                {typedOrder.temu_order_sn ?? "Not synced"}
              </dd>
            </div>
            <div className="rounded-lg border border-line bg-black p-4">
              <dt className="text-muted">Sales channel</dt>
              <dd className="mt-1 text-foreground">{typedOrder.sales_channel}</dd>
            </div>
            <div className="rounded-lg border border-line bg-black p-4">
              <dt className="text-muted">Last Temu sync</dt>
              <dd className="mt-1 text-foreground">
                {typedOrder.temu_last_synced_at
                  ? formatDate(typedOrder.temu_last_synced_at)
                  : "Not available"}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-muted">
            Temu status is intentionally coarse. Keep production notes and the
            DIY proof locally because Partner order payloads may omit design and
            detailed internal production fields.
          </p>
        </section>

        <section className="mt-5 rounded-lg border border-line bg-panel/85 p-5">
          <h2 className="mb-4 text-xl font-black">Design snapshot</h2>
          <DesignSummary
            design={typedOrder.design_snapshot}
            imageUrls={imageUrls}
          />
        </section>

        <section className="mt-5 rounded-lg border border-line bg-panel/85 p-5">
          <h2 className="mb-4 text-xl font-black">Event log</h2>
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
              <p className="text-sm text-muted">No status events yet.</p>
            )}
          </div>
        </section>
      </main>
    </AppShell>
  );
}
