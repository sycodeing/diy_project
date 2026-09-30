import type { FulfillmentStatus, TemuOrderStatus } from "@/lib/types";

export const TEMU_STATUS_OPTIONS: Array<{
  value: TemuOrderStatus;
  label: string;
  description: string;
}> = [
  {
    value: "NOT_SUBMITTED",
    label: "Not submitted to Temu",
    description: "Local order only. Temu has not returned an order number yet.",
  },
  {
    value: "UN_SHIPPING",
    label: "Awaiting shipment",
    description: "Temu V2 order status 2, also shown as UN_SHIPPING.",
  },
  {
    value: "CANCELED",
    label: "Canceled",
    description: "Temu V2 order status 3.",
  },
  {
    value: "SHIPPED",
    label: "Shipped",
    description: "Temu V2 order status 4.",
  },
  {
    value: "UNKNOWN",
    label: "Unknown",
    description: "Stored raw payload did not contain a mapped Temu status.",
  },
];

export function getTemuStatusLabel(status: TemuOrderStatus | string | null) {
  return (
    TEMU_STATUS_OPTIONS.find((option) => option.value === status)?.label ??
    "Unknown"
  );
}

export function normalizeTemuStatus(status: unknown): TemuOrderStatus {
  const value = String(status ?? "").trim().toUpperCase();

  if (value === "2" || value === "UN_SHIPPING" || value === "UNSHIPPING") {
    return "UN_SHIPPING";
  }

  if (value === "3" || value === "CANCELED" || value === "CANCELLED") {
    return "CANCELED";
  }

  if (
    value === "4" ||
    value === "5" ||
    value === "41" ||
    value === "51" ||
    value === "SHIPPED" ||
    value === "RECEIPTED"
  ) {
    return "SHIPPED";
  }

  if (value === "NOT_SUBMITTED" || value === "") {
    return "NOT_SUBMITTED";
  }

  return "UNKNOWN";
}

export function mapTemuToFulfillmentStatus(
  temuStatus: TemuOrderStatus,
): FulfillmentStatus {
  switch (temuStatus) {
    case "UN_SHIPPING":
      return "packing";
    case "SHIPPED":
      return "shipped";
    case "CANCELED":
    case "NOT_SUBMITTED":
    case "UNKNOWN":
    default:
      return "production";
  }
}
