import { TEMU_PROCUREMENT_PRODUCT } from "@/lib/temu-procurement";
import type { DesignPayload, ProductProcurement } from "@/lib/types";

const LEGACY_PROCUREMENT: ProductProcurement = {
  provider: "temu",
  productTitle: TEMU_PROCUREMENT_PRODUCT.productTitle,
  goodsId: TEMU_PROCUREMENT_PRODUCT.goodsId,
  skuId: null,
  selectionInstruction: TEMU_PROCUREMENT_PRODUCT.selectionInstruction,
  quantity: 1,
  expectedAmountCents: null,
  currency: TEMU_PROCUREMENT_PRODUCT.currency,
};

export function resolveProductProcurement(value: unknown): ProductProcurement {
  const design = value && typeof value === "object" && !Array.isArray(value)
    ? value as DesignPayload
    : null;
  const procurement = design?.productSnapshot?.procurement;
  if (procurement && (procurement.provider === "temu" || procurement.provider === "manual")) {
    return procurement;
  }

  const snapshot = design?.productSnapshot;
  if (!snapshot) return LEGACY_PROCUREMENT;

  return {
    provider: "manual",
    productTitle: snapshot.name,
    goodsId: null,
    skuId: null,
    selectionInstruction: Object.values(snapshot.options).join(" / ") || "Check the order product snapshot",
    quantity: snapshot.quantity || 1,
    expectedAmountCents: null,
    currency: "usd",
  };
}

export function getProcurementJobStatus(procurement: ProductProcurement) {
  return procurement.provider === "temu" && procurement.goodsId
    ? "ready_for_payment" as const
    : "configuration_required" as const;
}
