"use client";

import { FormEvent, useState } from "react";
import { Check, MapPin, X } from "lucide-react";
import {
  COUNTRY_OPTIONS,
  formatServiceArea,
  validateShippingAddress,
} from "@/lib/service-area";
import type { ShippingAddress } from "@/lib/types";

export function CheckoutAddressDialog({
  initialAddress,
  onClose,
  onConfirm,
}: {
  initialAddress: ShippingAddress;
  onClose: () => void;
  onConfirm: (address: ShippingAddress) => void;
}) {
  const [message, setMessage] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const address: ShippingAddress = {
      fullName: String(data.get("fullName") ?? "").trim(),
      line1: String(data.get("line1") ?? "").trim(),
      line2: String(data.get("line2") ?? "").trim() || undefined,
      city: String(data.get("city") ?? "").trim(),
      region: String(data.get("region") ?? "").trim(),
      postalCode: String(data.get("postalCode") ?? "").trim(),
      country: String(data.get("country") ?? "").trim().toUpperCase(),
      phone: String(data.get("phone") ?? "").trim() || undefined,
    };
    const validation = validateShippingAddress(address);

    if (!validation.ok) {
      setMessage(validation.message);
      return;
    }

    onConfirm(address);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/80 px-4 py-6 backdrop-blur">
      <section className="w-full max-w-2xl rounded-lg border border-line bg-panel p-5 shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-accent">
              <MapPin size={15} /> Delivery check
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-normal">
              Where should we send it?
            </h2>
            <p className="mt-2 text-sm text-muted">
              Current service area: {formatServiceArea()}
            </p>
          </div>
          <button
            aria-label="Close address form"
            className="focus-ring grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-black text-muted hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <AddressField
            autoComplete="name"
            defaultValue={initialAddress.fullName}
            label="Full name"
            name="fullName"
          />
          <AddressField
            autoComplete="tel"
            defaultValue={initialAddress.phone}
            label="Phone (optional)"
            name="phone"
            required={false}
            type="tel"
          />
          <div className="sm:col-span-2">
            <AddressField
              autoComplete="address-line1"
              defaultValue={initialAddress.line1}
              label="Address"
              name="line1"
            />
          </div>
          <div className="sm:col-span-2">
            <AddressField
              autoComplete="address-line2"
              defaultValue={initialAddress.line2}
              label="Apartment, suite (optional)"
              name="line2"
              required={false}
            />
          </div>
          <AddressField
            autoComplete="address-level2"
            defaultValue={initialAddress.city}
            label="City"
            name="city"
          />
          <AddressField
            autoComplete="address-level1"
            defaultValue={initialAddress.region}
            label="State / province"
            name="region"
          />
          <AddressField
            autoComplete="postal-code"
            defaultValue={initialAddress.postalCode}
            label="Postal code"
            name="postalCode"
          />
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-muted">Country</span>
            <select
              autoComplete="country"
              className="focus-ring h-12 w-full rounded-lg border border-line bg-black px-3 text-foreground"
              defaultValue={initialAddress.country || "US"}
              name="country"
              required
            >
              {COUNTRY_OPTIONS.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.label}
                </option>
              ))}
            </select>
          </label>

          {message ? (
            <p
              className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100 sm:col-span-2"
              role="alert"
            >
              {message}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:col-span-2 sm:flex-row sm:justify-end">
            <button
              className="focus-ring h-12 rounded-lg border border-line bg-black px-5 font-bold text-muted hover:text-foreground"
              onClick={onClose}
              type="button"
            >
              Back to preview
            </button>
            <button
              className="focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-accent px-5 font-black text-accent-ink hover:bg-foreground"
              type="submit"
            >
              <Check size={18} /> Confirm mock order
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AddressField({
  autoComplete,
  defaultValue,
  label,
  name,
  required = true,
  type = "text",
}: {
  autoComplete: string;
  defaultValue?: string;
  label: string;
  name: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-muted">{label}</span>
      <input
        autoComplete={autoComplete}
        className="focus-ring h-12 w-full rounded-lg border border-line bg-black px-3 text-foreground placeholder:text-stone-600"
        defaultValue={defaultValue}
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}
