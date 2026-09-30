import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CreditCard,
  ExternalLink,
  ImageDown,
  PackageCheck,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { CopyButton, CopyField } from "@/components/copy-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { createDesignImageUrls } from "@/lib/design-images";
import {
  COLOR_OPTIONS,
  getOptionLabel,
  STYLE_OPTIONS,
} from "@/lib/product-config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TEMU_PROCUREMENT_PRODUCT } from "@/lib/temu-procurement";
import {
  ATTENTION_TEMU_PURCHASE_STATUSES,
  getNextFulfillmentStatus,
  INTERNAL_FULFILLMENT_LABELS,
  TEMU_PURCHASE_STATUS_LABELS,
} from "@/lib/temu-purchase";
import type {
  FulfillmentStatus,
  OrderSummary,
  TemuPurchaseJob,
} from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import {
  advanceManualFulfillmentStatus,
  bindManualTemuOrder,
  refreshTemuJobConfiguration,
  returnTemuJobToQueue,
} from "./actions";

const fulfillmentStages: FulfillmentStatus[] = [
  "ordered",
  "production",
  "packing",
  "shipped",
];

export default async function TemuPurchasesPage() {
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
  const [{ data: jobs }, { data: orders }] = await Promise.all([
    supabase
      .from("temu_purchase_jobs")
      .select("*")
      .order("created_at", { ascending: true }),
    supabase
      .from("orders")
      .select(
        "id,order_number,amount_cents,currency,customer_email,payment_status,fulfillment_status,sales_channel,temu_parent_order_sn,temu_order_sn,temu_status,temu_status_label,temu_last_synced_at,temu_raw,design_snapshot,shipping,paid_at,created_at,updated_at",
      ),
  ]);

  const typedJobs = (jobs ?? []) as TemuPurchaseJob[];
  const typedOrders = (orders ?? []) as OrderSummary[];
  const ordersById = new Map(typedOrders.map((order) => [order.id, order]));
  const artworkByOrderId = new Map(
    await Promise.all(
      typedOrders.map(
        async (order) =>
          [
            order.id,
            await createDesignImageUrls(supabase, order.design_snapshot),
          ] as const,
      ),
    ),
  );
  const readyJobs = typedJobs.filter((job) => job.status === "ready_for_payment");
  const attentionJobs = typedJobs.filter((job) =>
    ATTENTION_TEMU_PURCHASE_STATUSES.includes(job.status),
  );
  const boundJobs = typedJobs.filter((job) => job.status === "temu_bound");

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">
              Manual purchase desk
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-normal">
              人工下单工作台
            </h1>
            <p className="mt-2 text-sm text-muted">
              复制资料、打开商品、录入平台单号，并手动推进真实履约状态。
            </p>
          </div>
          <Link
            className="focus-ring inline-flex h-11 items-center justify-center rounded-lg border border-line px-4 text-sm font-bold text-muted hover:text-foreground"
            href="/admin/orders"
          >
            查看全部订单
          </Link>
        </div>

        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          <SummaryCard
            icon={<CreditCard size={19} />}
            label="待人工下单"
            value={String(readyJobs.length)}
          />
          <SummaryCard
            icon={<PackageCheck size={19} />}
            label="已绑定 Temu"
            value={String(boundJobs.length)}
          />
          <SummaryCard
            icon={<AlertTriangle size={19} />}
            label="需要处理"
            value={String(attentionJobs.length)}
          />
        </section>

        <div className="mt-6 space-y-5">
          {typedJobs.length ? (
            typedJobs.map((job) => {
              const order = ordersById.get(job.order_id);
              const design = order?.design_snapshot;
              const artworkUrls = artworkByOrderId.get(job.order_id) ?? {};
              const artworkUrl = artworkUrls.front ?? artworkUrls.back;
              const productUrl =
                job.product_url ?? TEMU_PROCUREMENT_PRODUCT.productUrl;
              const address = job.address_snapshot;
              const fullAddress = [
                address.fullName,
                address.phone,
                address.line1,
                address.line2,
                `${address.city}, ${address.region} ${address.postalCode}`,
                address.country,
              ]
                .filter(Boolean)
                .join("\n");
              const productSpec = design
                ? [
                    design.selection.size,
                    getOptionLabel(STYLE_OPTIONS, design.selection.style),
                    getOptionLabel(COLOR_OPTIONS, design.selection.color),
                  ].join(" / ")
                : TEMU_PROCUREMENT_PRODUCT.selectionInstruction;
              const purchaseSummary = [
                `站内订单：${order?.order_number ?? job.order_id}`,
                `客户邮箱：${order?.customer_email ?? ""}`,
                `商品：${TEMU_PROCUREMENT_PRODUCT.productTitle}`,
                `规格：${productSpec}`,
                `下单提示：${TEMU_PROCUREMENT_PRODUCT.selectionInstruction}`,
                `数量：${job.quantity}`,
                `Goods ID：${job.goods_id ?? TEMU_PROCUREMENT_PRODUCT.goodsId}`,
                `商品链接：${productUrl ?? ""}`,
                artworkUrl ? `定制图：${artworkUrl}` : "定制图：请在订单详情核对",
                "",
                "收件信息：",
                fullAddress,
              ].join("\n");
              const nextStatus = order
                ? getNextFulfillmentStatus(order.fulfillment_status)
                : null;

              return (
                <article
                  className="overflow-hidden rounded-xl border border-line bg-panel/90"
                  key={job.id}
                >
                  <div className="flex flex-col gap-3 border-b border-line bg-black/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded border border-line bg-black px-2 py-1 text-xs font-black text-accent">
                        {TEMU_PURCHASE_STATUS_LABELS[job.status]}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        <Clock3 size={13} /> {formatDate(job.created_at)}
                      </span>
                    </div>
                    <CopyButton
                      label="复制全部下单信息"
                      value={purchaseSummary}
                    />
                  </div>

                  <div className="grid gap-5 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                    <div className="space-y-4">
                      <div>
                        <Link
                          className="font-mono text-sm text-accent hover:text-foreground"
                          href={`/admin/orders/${job.order_id}`}
                        >
                          {order?.order_number ?? job.order_id}
                        </Link>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-black">
                            {order?.customer_email ?? "未知客户"}
                          </h2>
                          <CopyButton
                            label="复制邮箱"
                            value={order?.customer_email ?? ""}
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 rounded-lg border border-line bg-black p-4 lg:grid-cols-[160px_minmax(0,1fr)]">
                        <div className="overflow-hidden rounded-lg border border-line bg-foreground">
                          {artworkUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              alt="客户定制原图"
                              className="aspect-square h-full w-full object-cover"
                              src={artworkUrl}
                            />
                          ) : (
                            <div className="grid aspect-square place-items-center px-3 text-center text-xs font-bold text-background">
                              暂无可用定制图
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-muted">
                            下单商品
                          </p>
                          <p className="mt-1 font-black">
                            {TEMU_PROCUREMENT_PRODUCT.productTitle}
                          </p>
                          <div className="mt-3">
                            <CopyField label="选择规格" value={productSpec} />
                            <CopyField
                              label="数量"
                              value={String(job.quantity)}
                            />
                            <CopyField
                              label="Goods ID"
                              value={
                                job.goods_id ?? TEMU_PROCUREMENT_PRODUCT.goodsId
                              }
                            />
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {productUrl ? (
                              <a
                                className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-black text-accent-ink"
                                href={productUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                打开 Temu 商品 <ExternalLink size={15} />
                              </a>
                            ) : null}
                            {artworkUrl ? (
                              <a
                                className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm font-bold text-foreground"
                                download
                                href={artworkUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                打开定制原图 <ImageDown size={15} />
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {job.last_error_message ? (
                        <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">
                          {job.last_error_code
                            ? `${job.last_error_code}: `
                            : ""}
                          {job.last_error_message}
                        </p>
                      ) : null}
                      {job.status === "submit_uncertain" ? (
                        <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">
                          请先检查 Temu
                          买家订单记录，确认是否已经生成订单，严禁直接重复下单。
                        </p>
                      ) : null}

                      {job.status === "temu_bound" ? (
                        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
                          <p className="mb-2 font-black text-emerald-200">
                            Temu 订单已录入
                          </p>
                          <CopyField
                            label="Temu 父订单号"
                            value={job.temu_parent_order_sn ?? ""}
                          />
                          <CopyField
                            label="Temu 子订单号"
                            value={job.temu_order_sn ?? ""}
                          />
                        </div>
                      ) : job.status !== "canceled" ? (
                        <form
                          action={bindManualTemuOrder}
                          className="grid gap-3 rounded-lg border border-line p-4 sm:grid-cols-2"
                        >
                          <input name="jobId" type="hidden" value={job.id} />
                          <label className="text-sm font-bold">
                            Temu 父订单号
                            <input
                              className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-black px-3 font-mono text-sm"
                              name="temuParentOrderSn"
                              placeholder="PO-..."
                              required
                            />
                          </label>
                          <label className="text-sm font-bold">
                            Temu 子订单号（可选）
                            <input
                              className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-black px-3 font-mono text-sm"
                              name="temuOrderSn"
                              placeholder="211-..."
                            />
                          </label>
                          <FormSubmitButton
                            className="focus-ring h-11 rounded-lg bg-foreground px-4 text-sm font-black text-background disabled:cursor-wait disabled:opacity-60 sm:col-span-2"
                            idleLabel="确认已下单并绑定 Temu 订单"
                            pendingLabel="正在保存 Temu 订单…"
                          />
                        </form>
                      ) : null}
                    </div>

                    <aside className="space-y-4">
                      <div className="rounded-lg border border-line bg-black p-4 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-black">收件信息</p>
                          <CopyButton label="复制完整地址" value={fullAddress} />
                        </div>
                        <div className="mt-2">
                          <CopyField label="收件人" value={address.fullName} />
                          <CopyField label="电话" value={address.phone ?? ""} />
                          <CopyField label="地址 1" value={address.line1} />
                          {address.line2 ? (
                            <CopyField label="地址 2" value={address.line2} />
                          ) : null}
                          <CopyField label="城市" value={address.city} />
                          <CopyField label="州 / 地区" value={address.region} />
                          <CopyField label="邮编" value={address.postalCode} />
                          <CopyField label="国家" value={address.country} />
                        </div>
                      </div>

                      {order ? (
                        <div className="rounded-lg border border-line bg-black p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-black uppercase tracking-[0.12em] text-muted">
                                内部真实状态
                              </p>
                              <p className="mt-1 text-lg font-black text-accent">
                                {
                                  INTERNAL_FULFILLMENT_LABELS[
                                    order.fulfillment_status
                                  ]
                                }
                              </p>
                            </div>
                            {order.fulfillment_status === "shipped" ? (
                              <CheckCircle2
                                className="text-emerald-400"
                                size={25}
                              />
                            ) : null}
                          </div>
                          <FulfillmentProgress
                            current={order.fulfillment_status}
                          />
                          <p className="mt-3 text-xs leading-5 text-muted">
                            用户端始终显示“已下单”，这里只记录真实采购与履约进度。
                          </p>
                          {nextStatus &&
                          (nextStatus !== "production" ||
                            job.status === "temu_bound") ? (
                            <form
                              action={advanceManualFulfillmentStatus}
                              className="mt-4"
                            >
                              <input
                                name="orderId"
                                type="hidden"
                                value={order.id}
                              />
                              <input
                                name="status"
                                type="hidden"
                                value={nextStatus}
                              />
                              <FormSubmitButton
                                className="focus-ring h-11 w-full rounded-lg bg-accent px-3 text-sm font-black text-accent-ink disabled:cursor-wait disabled:opacity-60"
                                idleLabel={`标记为：${INTERNAL_FULFILLMENT_LABELS[nextStatus]}`}
                              />
                            </form>
                          ) : null}
                        </div>
                      ) : null}

                      {job.status === "configuration_required" ? (
                        <form action={refreshTemuJobConfiguration}>
                          <input name="jobId" type="hidden" value={job.id} />
                          <button
                            className="focus-ring h-10 w-full rounded-lg bg-accent px-3 font-black text-accent-ink"
                            type="submit"
                          >
                            应用当前商品配置
                          </button>
                        </form>
                      ) : null}

                      {![
                        "ready_for_payment",
                        "in_progress",
                        "submit_uncertain",
                        "temu_bound",
                        "configuration_required",
                        "canceled",
                      ].includes(job.status) ? (
                        <form action={returnTemuJobToQueue}>
                          <input name="jobId" type="hidden" value={job.id} />
                          <button
                            className="focus-ring h-10 w-full rounded-lg border border-line px-3 font-bold text-foreground"
                            type="submit"
                          >
                            退回待下单队列
                          </button>
                        </form>
                      ) : null}
                    </aside>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="rounded-lg border border-line bg-panel/80 p-8 text-center">
              <p className="text-lg font-black">
                目前没有等待处理的已付款订单。
              </p>
              <p className="mt-2 text-muted">
                Stripe 确认付款后，系统会自动生成一条人工下单任务。
              </p>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function FulfillmentProgress({ current }: { current: FulfillmentStatus }) {
  const currentIndex = fulfillmentStages.indexOf(current);

  return (
    <div className="mt-4 grid grid-cols-4 gap-1">
      {fulfillmentStages.map((status, index) => (
        <div key={status}>
          <div
            className={cn(
              "h-1.5 rounded-full",
              index <= currentIndex ? "bg-accent" : "bg-line",
            )}
          />
          <p className="mt-2 text-[10px] font-bold leading-4 text-muted">
            {INTERNAL_FULFILLMENT_LABELS[status]}
          </p>
        </div>
      ))}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel/85 p-4">
      <div className="text-accent">{icon}</div>
      <p className="mt-4 text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}
