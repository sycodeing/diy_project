import type { ShippingAddress } from "@/lib/types";

export const COUNTRY_OPTIONS = [
  { code: "US", label: "United States" },
  { code: "CN", label: "China" },
  { code: "CA", label: "Canada" },
  { code: "GB", label: "United Kingdom" },
  { code: "AU", label: "Australia" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
] as const;

const DEFAULT_ALLOWED_COUNTRIES = ["US", "CN"];

export function getAllowedCountries() {
  const configured = process.env.NEXT_PUBLIC_ALLOWED_COUNTRIES;
  const countries = configured
    ?.split(",")
    .map((country) => country.trim().toUpperCase())
    .filter(Boolean);

  return countries?.length ? countries : DEFAULT_ALLOWED_COUNTRIES;
}

export function getAllowedRegions() {
  const configured = process.env.NEXT_PUBLIC_ALLOWED_REGIONS;

  if (!configured?.trim()) {
    return new Map<string, Set<string>>();
  }

  const regions = new Map<string, Set<string>>();

  for (const entry of configured.split("|")) {
    const [country, region] = entry
      .split(":")
      .map((value) => value.trim().toUpperCase());

    if (!country || !region) {
      continue;
    }

    const countryRegions = regions.get(country) ?? new Set<string>();
    countryRegions.add(region);
    regions.set(country, countryRegions);
  }

  return regions;
}

export function validateShippingAddress(address: ShippingAddress) {
  const country = address.country.trim().toUpperCase();
  const region = address.region.trim().toUpperCase();
  const allowedCountries = getAllowedCountries();

  if (!allowedCountries.includes(country)) {
    return {
      ok: false,
      message: `This product is currently available only in ${formatCountryList(
        allowedCountries,
      )}.`,
    };
  }

  const allowedRegions = getAllowedRegions().get(country);

  if (allowedRegions?.size && !allowedRegions.has(region)) {
    return {
      ok: false,
      message: `We cannot ship to ${address.region} yet. Available regions: ${[
        ...allowedRegions,
      ].join(", ")}.`,
    };
  }

  return { ok: true, message: null };
}

export function formatServiceArea() {
  const allowedCountries = getAllowedCountries();
  const allowedRegions = getAllowedRegions();

  return allowedCountries
    .map((country) => {
      const regions = allowedRegions.get(country);
      return regions?.size ? `${country}: ${[...regions].join(", ")}` : country;
    })
    .join(" · ");
}

function formatCountryList(countryCodes: string[]) {
  return countryCodes
    .map(
      (code) =>
        COUNTRY_OPTIONS.find((country) => country.code === code)?.label ?? code,
    )
    .join(", ");
}
