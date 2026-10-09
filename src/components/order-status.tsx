import { Box, Check, Factory, PackageCheck, ShoppingBag, Truck, CircleCheck } from "lucide-react";
import { getTemuStatusLabel } from "@/lib/temu";
import type {
  FulfillmentStatus,
  PaymentStatus,
  TemuOrderStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const stages: Array<{
  key: FulfillmentStatus;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { key: "awaiting_payment", label: "待付款", icon: Check },
  { key: "ordered", label: "待发货", icon: ShoppingBag },
  { key: "production", label: "生产中", icon: Factory },
  { key: "packing", label: "打包中", icon: Box },
  { key: "shipped", label: "已发货", icon: Truck },
  { key: "delivered", label: "已送达", icon: CircleCheck },
];

const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending_payment: "待付款",
  payment_pending: "付款处理中",
  paid: "已付款",
  failed: "付款失败",
  canceled: "已取消",
  partially_refunded: "部分退款",
  refunded: "已退款",
  reversed: "付款已撤销",
  disputed: "付款争议处理中",
};

export function OrderStatus({
  fulfillmentStatus,
  paymentStatus,
  temuStatus,
}: {
  fulfillmentStatus: FulfillmentStatus;
  paymentStatus: PaymentStatus;
  temuStatus?: TemuOrderStatus;
}) {
  const currentIndex = stages.findIndex((stage) => stage.key === fulfillmentStatus);

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-center gap-2">
          <PackageCheck size={16} />
          付款状态：{paymentStatusLabels[paymentStatus]}
        </span>
        {temuStatus ? (
          <span className="rounded-lg border border-line bg-surface px-2 py-1 text-xs font-bold text-foreground">
            Temu: {getTemuStatusLabel(temuStatus)}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          const active = index <= currentIndex;

          return (
            <div
              className={cn(
                "rounded-lg border p-3 text-center text-xs font-bold",
                active
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-line bg-panel text-muted",
              )}
              key={stage.key}
            >
              <Icon className="mx-auto mb-2" size={18} />
              {stage.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CustomerOrderStatus({
  fulfillmentStatus,
  paymentStatus,
}: {
  fulfillmentStatus: FulfillmentStatus;
  paymentStatus: PaymentStatus;
}) {
  const isPaid = paymentStatus === "paid";
  const delivered = fulfillmentStatus === "delivered";
  const shipped = fulfillmentStatus === "shipped";
  const paymentOverride = paymentStatus === "payment_pending"
    ? "付款处理中"
    : paymentStatus === "partially_refunded"
      ? "部分退款"
      : paymentStatus === "refunded"
        ? "已退款"
        : paymentStatus === "reversed"
          ? "付款已撤销"
          : paymentStatus === "disputed"
            ? "付款争议处理中"
            : paymentStatus === "failed"
              ? "付款失败"
              : paymentStatus === "canceled"
                ? "付款已取消"
                : null;
  const label = paymentOverride ?? (delivered
    ? "已送达"
    : shipped
      ? "已发货"
      : isPaid
        ? "待发货"
        : "等待付款");

  const paymentMessage = paymentStatus === "payment_pending"
    ? "PayPal 正在处理付款，确认完成前不会进入制作和发货。"
    : paymentStatus === "partially_refunded"
      ? "订单已有部分退款，请留意 PayPal 通知；我们会人工核对后续处理。"
      : paymentStatus === "refunded"
        ? "该订单款项已退款，到账时间以 PayPal 或发卡行处理为准。"
        : paymentStatus === "reversed"
          ? "PayPal 已撤销该笔付款，我们会暂停尚未开始的履约。"
          : paymentStatus === "disputed"
            ? "该笔付款正在 PayPal 争议处理中，我们会同步跟进。"
            : null;

  return (
    <div className="rounded-lg border border-accent/50 bg-accent/10 p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-accent text-accent-ink">
          <ShoppingBag size={19} />
        </span>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-muted">
            订单状态
          </p>
          <p className="mt-1 text-lg font-black text-foreground">{label}</p>
        </div>
      </div>
      {paymentMessage ? (
        <p className="mt-3 text-sm text-muted">{paymentMessage}</p>
      ) : isPaid ? (
        <p className="mt-3 text-sm text-muted">
          {delivered
            ? "订单已送达，感谢您的购买。"
            : shipped
              ? "订单已发出，请留意物流更新。"
              : "订单已确认，正在等待发货。"}
        </p>
      ) : null}
    </div>
  );
}
