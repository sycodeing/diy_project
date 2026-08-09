import { Box, Check, Factory, PackageCheck, Truck } from "lucide-react";
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
  { key: "awaiting_payment", label: "Payment", icon: Check },
  { key: "production", label: "Production", icon: Factory },
  { key: "packing", label: "Packing", icon: Box },
  { key: "shipped", label: "Shipped", icon: Truck },
];

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
          Payment: {paymentStatus.replaceAll("_", " ")}
        </span>
        {temuStatus ? (
          <span className="rounded-lg border border-line bg-black px-2 py-1 text-xs font-bold text-foreground">
            Temu: {getTemuStatusLabel(temuStatus)}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          const active = index <= currentIndex;

          return (
            <div
              className={cn(
                "rounded-lg border p-3 text-center text-xs font-bold",
                active
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-line bg-black text-muted",
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
