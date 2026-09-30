import { createHash } from "node:crypto";
import type { ShippingAddress } from "@/lib/types";

export function normalizeShippingAddress(address: ShippingAddress) {
  return {
    fullName: normalizeWords(address.fullName),
    line1: normalizeWords(address.line1),
    line2: normalizeWords(address.line2 ?? "") || undefined,
    city: normalizeWords(address.city),
    region: normalizeWords(address.region).toUpperCase(),
    postalCode: address.postalCode.trim().toUpperCase().replace(/\s+/g, " "),
    country: address.country.trim().toUpperCase(),
    phone: (address.phone ?? "").trim().replace(/[\s()-]+/g, ""),
  } satisfies ShippingAddress;
}

export function createShippingFingerprint(address: ShippingAddress) {
  const normalized = normalizeShippingAddress(address);
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

function normalizeWords(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
