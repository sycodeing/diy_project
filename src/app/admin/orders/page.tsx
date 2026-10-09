import Link from "next/link";
import Image from "next/image";
import { Image as ImageIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-field";
import { OrderStatus } from "@/components/order-status";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { createAdminDesignImageUrls } from "@/lib/design-images";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TEMU_STATUS_OPTIONS } from "@/lib/temu";
import type { OrderSummary } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/utils";
import { updateOrderStatus } from "./actions";
import { advanceManualFulfillmentStatus } from "../temu-purchases/actions";
import { getNextFulfillmentStatus, INTERNAL_FULFILLMENT_LABELS } from "@/lib/temu-purchase";

const statusOptions = ["ordered", "production", "packing", "shipped", "delivered"] as const;

export default async function AdminOrdersPage() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <AppShell admin>
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

  const typedOrders = (orders ?? []) as OrderSummary[];
  const artworkByOrderId = new Map(
    await Promise.all(
      typedOrders.map(async (order) => [
        order.id,
        await createAdminDesignImageUrls(order.design_snapshot),
      ] as const),
    ),
  );

  return (
    <AppShell admin>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-4xl font-black tracking-normal">订单管理</h1>
        </div>

        <div className="space-y-3">
          {typedOrders.length ? (
            typedOrders.map((order) => {
              const artwork = artworkByOrderId.get(order.id) ?? {};
              const artworkUrl = artwork.front ?? artwork.back;
              const product = order.design_snapshot.productSnapshot;

              return (
              <article
                className="rounded-xl border border-line bg-panel/85 p-5"
                key={order.id}
              >
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
                  <div className="min-w-0">
                    <div className="flex gap-4">
                      <div className="relative grid size-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-white sm:size-32">
                        {artworkUrl ? (
                          <Image
                            alt={`${product?.name ?? "Custom product"} artwork`}
                            className="object-contain p-2"
                            height={128}
                            src={artworkUrl}
                            unoptimized
                            width={128}
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-2 px-2 text-center text-xs text-muted">
                            <ImageIcon aria-hidden="true" size={22} />
                            <span>Artwork unavailable</span>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <Link
                            className="font-mono text-sm text-accent hover:text-foreground"
                            href={`/admin/orders/${order.id}`}
                          >
                            {order.order_number}
                          </Link>
                          <span className="text-xs text-muted">
                            {formatDate(order.created_at)}
                          </span>
                        </div>
                        <h2 className="mt-1 truncate text-lg font-black">
                          {product?.name ?? "Custom product"}
                        </h2>
                        <p className="mt-1 truncate text-sm text-muted">
                          {order.customer_email ?? "Unknown customer"}
                        </p>
                        <p className="mt-1 text-sm font-bold text-foreground">
                          {formatMoney(order.amount_cents, order.currency)}
                          {product?.quantity ? ` · Qty ${product.quantity}` : ""}
                        </p>
                        {order.temu_parent_order_sn || order.temu_order_sn ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {order.temu_parent_order_sn ? (
                              <CopyButton
                                label="复制 Temu 父单号"
                                value={order.temu_parent_order_sn}
                              />
                            ) : null}
                            {order.temu_order_sn ? (
                              <CopyButton
                                label="复制 Temu 子单号"
                                value={order.temu_order_sn}
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  <div className="mt-4">
                      <OrderStatus
                        fulfillmentStatus={order.fulfillment_status}
                        paymentStatus={order.payment_status}
                        temuStatus={order.temu_status}
                      />
                    </div>
                  </div>
                  {getNextFulfillmentStatus(order.fulfillment_status) ? (
                    <form action={advanceManualFulfillmentStatus} className="mt-3">
                      <input name="orderId" type="hidden" value={order.id} />
                      <input name="status" type="hidden" value={getNextFulfillmentStatus(order.fulfillment_status)!} />
                      <button className="focus-ring h-10 rounded-lg border border-accent/40 bg-accent-soft px-4 text-sm font-black text-accent-strong hover:bg-accent/15" type="submit">
                        推进至：{INTERNAL_FULFILLMENT_LABELS[getNextFulfillmentStatus(order.fulfillment_status)!]}
                      </button>
                    </form>
                  ) : null}

                  <form
                    action={updateOrderStatus}
                    className="grid content-start gap-3 rounded-xl bg-surface/80 p-3 sm:grid-cols-2 sm:p-4"
                  >
                    <input name="orderId" type="hidden" value={order.id} />
                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-muted">
                        履约状态
                      </span>
                      <select
                        className="focus-ring h-11 w-full rounded-lg border border-line bg-white px-3 text-foreground"
                        defaultValue={order.fulfillment_status}
                        name="status"
                      >
                        {statusOptions.map((status) => (
                          <option key={status} value={status}>
                            {fulfillmentLabel(status)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-muted">
                        Temu 订单状态
                      </span>
                      <select
                        className="focus-ring h-11 w-full rounded-lg border border-line bg-white px-3 text-foreground"
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
                    <label className="block">
                        <span className="mb-2 block text-sm font-bold text-muted">
                          Temu 父订单号
                        </span>
                        <input
                          className="focus-ring h-10 w-full rounded-lg border border-line bg-white px-3 font-mono text-sm text-foreground placeholder:text-muted"
                          defaultValue={order.temu_parent_order_sn ?? ""}
                          name="temuParentOrderSn"
                          placeholder="父订单号"
                        />
                    </label>
                    <label className="block">
                        <span className="mb-2 block text-sm font-bold text-muted">
                          Temu 子订单号（可选）
                        </span>
                        <input
                          className="focus-ring h-10 w-full rounded-lg border border-line bg-white px-3 font-mono text-sm text-foreground placeholder:text-muted"
                          defaultValue={order.temu_order_sn ?? ""}
                          name="temuOrderSn"
                          placeholder="子订单号"
                        />
                    </label>
                    <label className="block sm:col-span-2">
                        <span className="mb-2 block text-sm font-bold text-muted">
                          备注（可选）
                        </span>
                        <input
                        className="focus-ring h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-foreground placeholder:text-muted"
                        name="note"
                        placeholder="内部备注"
                      />
                    </label>
                    <button
                      className="focus-ring h-10 w-full rounded-lg bg-accent px-4 font-black text-accent-ink transition hover:bg-foreground active:translate-y-px sm:col-span-2"
                      type="submit"
                    >
                      保存并更新状态
                    </button>
                  </form>
                </div>
              </article>
            );
            })
          ) : (
            <div className="rounded-lg border border-line bg-panel/80 p-8 text-center">
              <p className="text-lg font-black">暂无订单</p>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function fulfillmentLabel(status: (typeof statusOptions)[number]) {
  return {
    ordered: "待发货",
    production: "生产中",
    packing: "打包中",
    shipped: "已发货",
    delivered: "已送达",
  }[status];
}
