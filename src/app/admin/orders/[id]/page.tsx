import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CopyField } from "@/components/copy-field";
import { DesignSummary } from "@/components/design-summary";
import { OrderStatus } from "@/components/order-status";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { createAdminDesignImageUrls } from "@/lib/design-images";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TEMU_STATUS_OPTIONS } from "@/lib/temu";
import type { FulfillmentStatus, OrderSummary, ShippingAddress } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/utils";
import { updateOrderStatus } from "../actions";
import { advanceManualFulfillmentStatus } from "../../temu-purchases/actions";
import { getNextFulfillmentStatus, INTERNAL_FULFILLMENT_LABELS } from "@/lib/temu-purchase";

const statusOptions = ["ordered", "production", "packing", "shipped", "delivered"] as const;

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
  const imageUrls = await createAdminDesignImageUrls(typedOrder.design_snapshot);
  const shipping =
    typedOrder.shipping && typeof typedOrder.shipping === "object" && !Array.isArray(typedOrder.shipping)
      ? (typedOrder.shipping as Partial<ShippingAddress>)
      : {};
  const { data: events } = await supabase
    .from("order_status_events")
    .select("id,status,note,created_at")
    .eq("order_id", id)
    .order("created_at", { ascending: true });

  return (
    <AppShell admin>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <Link
          className="text-sm font-bold text-muted hover:text-foreground"
          href="/admin/orders"
        >
          返回订单管理
        </Link>

        <section className="mt-5 rounded-lg border border-line bg-panel/85 p-5">
          <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
            <div>
              <p className="font-mono text-sm text-accent">
                {typedOrder.order_number}
              </p>
              <h1 className="mt-2 text-4xl font-black tracking-normal">订单详情</h1>
              <p className="mt-2 break-all font-bold text-muted">
                {typedOrder.customer_email ?? "未知客户"}
              </p>
              <p className="mt-2 text-sm text-muted">
                {formatDate(typedOrder.created_at)} /{" "}
                {formatMoney(typedOrder.amount_cents, typedOrder.currency)}
              </p>
            </div>

            <form action={updateOrderStatus} className="space-y-3">
              <input name="orderId" type="hidden" value={typedOrder.id} />
              <select
                className="focus-ring h-11 w-full rounded-lg border border-line bg-white px-3 text-foreground"
                defaultValue={typedOrder.fulfillment_status}
                name="status"
              >
                {statusOptions.map((status) => (
                <option key={status} value={status}>
                    {fulfillmentLabel(status)}
                  </option>
                ))}
              </select>
              <select
                className="focus-ring h-11 w-full rounded-lg border border-line bg-white px-3 text-foreground"
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
                className="focus-ring h-11 w-full rounded-lg border border-line bg-white px-3 font-mono text-foreground placeholder:text-muted"
                defaultValue={typedOrder.temu_parent_order_sn ?? ""}
                name="temuParentOrderSn"
                placeholder="Temu 父订单号"
              />
              <input
                className="focus-ring h-11 w-full rounded-lg border border-line bg-white px-3 font-mono text-foreground placeholder:text-muted"
                defaultValue={typedOrder.temu_order_sn ?? ""}
                name="temuOrderSn"
                placeholder="Temu 子订单号（可选）"
              />
              <input
                className="focus-ring h-11 w-full rounded-lg border border-line bg-white px-3 text-foreground placeholder:text-muted"
                name="note"
                placeholder="内部备注（可选）"
              />
              <button
                className="focus-ring h-11 w-full rounded-lg bg-accent px-4 font-black text-accent-ink transition hover:bg-foreground active:translate-y-px"
                type="submit"
              >
                保存并更新状态
              </button>
            </form>
            {getNextFulfillmentStatus(typedOrder.fulfillment_status) ? (
              <form action={advanceManualFulfillmentStatus}>
                <input name="orderId" type="hidden" value={typedOrder.id} />
                <input name="status" type="hidden" value={getNextFulfillmentStatus(typedOrder.fulfillment_status)!} />
                <button className="focus-ring h-11 w-full rounded-lg border border-accent/40 bg-accent-soft px-4 font-black text-accent-strong hover:bg-accent/15" type="submit">
                  推进至：{INTERNAL_FULFILLMENT_LABELS[getNextFulfillmentStatus(typedOrder.fulfillment_status)!]}
                </button>
              </form>
            ) : null}
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
          <h2 className="mb-4 text-xl font-black">Temu 订单信息</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-surface p-4">
              <dt className="text-muted">父订单号</dt>
              <dd className="mt-1 font-mono text-foreground">
                {typedOrder.temu_parent_order_sn ?? "尚未填写"}
              </dd>
            </div>
            <div className="rounded-lg border border-line bg-surface p-4">
              <dt className="text-muted">子订单号</dt>
              <dd className="mt-1 font-mono text-foreground">
                {typedOrder.temu_order_sn ?? "尚未填写"}
              </dd>
            </div>
            <div className="rounded-lg border border-line bg-surface p-4">
              <dt className="text-muted">销售渠道</dt>
              <dd className="mt-1 text-foreground">
                {typedOrder.sales_channel === "temu" ? "Temu" : "站内"}
              </dd>
            </div>
            <div className="rounded-lg border border-line bg-surface p-4">
              <dt className="text-muted">最近同步时间</dt>
              <dd className="mt-1 text-foreground">
                {typedOrder.temu_last_synced_at
                  ? formatDate(typedOrder.temu_last_synced_at)
                  : "暂无"}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-muted">
            订单状态仅展示必要的履约信息。请在订单系统内保留生产备注和定制图。
          </p>
        </section>

        <section className="mt-5 rounded-lg border border-line bg-panel/85 p-5">
          <h2 className="mb-4 text-xl font-black">定制设计</h2>
          <DesignSummary
            design={typedOrder.design_snapshot}
            imageUrls={imageUrls}
          />
        </section>

        <section className="mt-5 rounded-lg border border-line bg-panel/85 p-5">
          <h2 className="mb-4 text-xl font-black">收件信息</h2>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <CopyField label="收件人" value={shipping.fullName ?? ""} />
            <CopyField label="电话" value={shipping.phone ?? ""} />
            <CopyField label="地址 1" value={shipping.line1 ?? ""} />
            <CopyField label="地址 2" value={shipping.line2 ?? ""} />
            <CopyField label="城市" value={shipping.city ?? ""} />
            <CopyField label="州 / 地区" value={shipping.region ?? ""} />
            <CopyField label="邮编" value={shipping.postalCode ?? ""} />
            <CopyField label="国家" value={shipping.country ?? ""} />
          </div>
        </section>

        <section className="mt-5 rounded-lg border border-line bg-panel/85 p-5">
          <h2 className="mb-4 text-xl font-black">状态记录</h2>
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
                  className="rounded-lg border border-line bg-surface p-4 text-sm"
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
              <p className="text-sm text-muted">暂无状态记录。</p>
            )}
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function fulfillmentLabel(status: FulfillmentStatus) {
  return {
    awaiting_payment: "待付款",
    ordered: "待发货",
    production: "生产中",
    packing: "打包中",
    shipped: "已发货",
    delivered: "已送达",
  }[status];
}
