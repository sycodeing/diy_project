import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DiyDesigner } from "@/components/diy-designer";
import { getPayPalConfig, getSupabaseBrowserConfig } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ShippingAddress } from "@/lib/types";

const ALLOWED_PARAMS = new Set([
  "image",
  "imageUrl",
  "img",
  "shape",
  "position",
  "checkout",
]);

export default async function DesignPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const paramEntries = Object.entries(params);
  const allowedEntries = paramEntries.filter(([key]) => ALLOWED_PARAMS.has(key));

  if (allowedEntries.length !== paramEntries.length) {
    const cleanParams = new URLSearchParams();

    for (const [key, value] of allowedEntries) {
      const firstValue = Array.isArray(value) ? value[0] : value;
      if (firstValue) cleanParams.set(key, firstValue);
    }

    const queryString = cleanParams.toString();
    redirect(queryString ? `/design?${queryString}` : "/design");
  }

  const initialParams = Object.fromEntries(
    allowedEntries.map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };
  const { data: latestOrder } = supabase && user
    ? await supabase
        .from("orders")
        .select("shipping")
        .eq("user_id", user.id)
        .not("shipping", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const defaultShippingAddress = toShippingAddress(latestOrder?.shipping);

  return (
    <AppShell>
      <DiyDesigner
      authEnabled={Boolean(getSupabaseBrowserConfig())}
      paypalEnabled={Boolean(getPayPalConfig().clientId && getPayPalConfig().clientSecret)}
        autoCheckout={initialParams.checkout === "1"}
        initialParams={initialParams}
        isAuthenticated={Boolean(user)}
        userId={user?.id ?? null}
        defaultShippingAddress={defaultShippingAddress}
      />
    </AppShell>
  );
}

function toShippingAddress(value: unknown): ShippingAddress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const address = value as Record<string, unknown>;
  const required = ["fullName", "line1", "city", "region", "postalCode", "country"];
  if (required.some((key) => typeof address[key] !== "string" || !address[key]?.trim())) {
    return null;
  }
  return {
    fullName: address.fullName as string,
    line1: address.line1 as string,
    line2: typeof address.line2 === "string" ? address.line2 : undefined,
    city: address.city as string,
    region: address.region as string,
    postalCode: address.postalCode as string,
    country: address.country as string,
    phone: typeof address.phone === "string" ? address.phone : undefined,
  };
}
