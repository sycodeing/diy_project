import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DiyDesigner } from "@/components/diy-designer";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseBrowserConfig } from "@/lib/env";

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
  const user = await getCurrentUser();

  return (
    <AppShell>
      <DiyDesigner
        authEnabled={Boolean(getSupabaseBrowserConfig())}
        autoCheckout={initialParams.checkout === "1"}
        initialParams={initialParams}
        isAuthenticated={Boolean(user)}
      />
    </AppShell>
  );
}
