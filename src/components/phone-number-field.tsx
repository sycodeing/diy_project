"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCountries,
  getCountryCallingCode,
  parseDigits,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryCallingOptions = getCountries()
  .map((country) => ({
    country,
    label: countryNames.of(country) ?? country,
    callingCode: getCountryCallingCode(country),
  }))
  .sort((left, right) => left.label.localeCompare(right.label));

export function PhoneNumberField({
  defaultCountry,
  defaultValue,
  label = "Phone",
  name = "phone",
}: {
  defaultCountry: string;
  defaultValue?: string;
  label?: string;
  name?: string;
}) {
  const requestedCountry = defaultCountry.toUpperCase();
  const safeDefaultCountry = countryCallingOptions.some(
    (option) => option.country === requestedCountry,
  )
    ? (requestedCountry as CountryCode)
    : "US";
  const parsedInitialPhone = useMemo(
    () =>
      defaultValue
        ? parsePhoneNumberFromString(defaultValue, safeDefaultCountry)
        : undefined,
    [defaultValue, safeDefaultCountry],
  );
  const [selectedCountry, setSelectedCountry] =
    useState<CountryCode>(parsedInitialPhone?.country ?? safeDefaultCountry);
  const previousDefaultCountry = useRef(safeDefaultCountry);
  const [nationalNumber, setNationalNumber] = useState(
    parsedInitialPhone?.nationalNumber ??
      (defaultValue?.startsWith("+")
        ? defaultValue.replace(/\D/g, "")
        : defaultValue ?? ""),
  );

  useEffect(() => {
    if (previousDefaultCountry.current !== safeDefaultCountry) {
      previousDefaultCountry.current = safeDefaultCountry;
      setSelectedCountry(safeDefaultCountry);
    }
  }, [safeDefaultCountry]);

  const callingCode = getCountryCallingCode(selectedCountry);
  const numberDigits = parseDigits(nationalNumber);
  const parsedNumber = numberDigits
    ? parsePhoneNumberFromString(numberDigits, selectedCountry)
    : undefined;
  const internationalNumber = numberDigits
    ? (parsedNumber?.number ?? `+${callingCode}${numberDigits}`)
    : "";

  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-muted">{label}</span>
      <span className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-2">
        <select
          aria-label="Phone country calling code"
          autoComplete="tel-country-code"
          className="focus-ring h-12 min-w-0 rounded-lg border border-line bg-panel px-2 text-sm text-foreground sm:px-3"
          onChange={(event) =>
            setSelectedCountry(event.target.value as CountryCode)
          }
          value={selectedCountry}
        >
          {countryCallingOptions.map((option) => (
            <option key={option.country} value={option.country}>
              {option.label} (+{option.callingCode})
            </option>
          ))}
        </select>
        <input
          autoComplete="tel-national"
          className="focus-ring h-12 min-w-0 rounded-lg border border-line bg-panel px-3 text-foreground placeholder:text-muted"
          inputMode="tel"
          onChange={(event) => setNationalNumber(event.target.value)}
          placeholder="Phone number"
          type="tel"
          value={nationalNumber}
        />
      </span>
      <input name={name} type="hidden" value={internationalNumber} />
      <span className="mt-1 block text-xs text-muted">
        Saved with the international calling code, for example +86.
      </span>
    </label>
  );
}
