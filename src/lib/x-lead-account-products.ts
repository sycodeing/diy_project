import { isProductCustomerCopyReady, isProductTemplateReady } from "@/lib/product-template-status";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { ActiveDraftProduct } from "@/lib/x-lead-account-draft";

export type ActiveAccountProduct = ActiveDraftProduct & {
  variants: Array<{ price_cents: number; currency: string }>;
  mockupTemplateIds?: string[];
};
export const ACCOUNT_PRODUCT_SLUGS = ["custom-pillow", "face-towel"] as const;

export async function getActiveAccountProducts(): Promise<ActiveAccountProduct[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Product catalog is unavailable");
  const { data: products, error } = await supabase.from("products")
    .select("id,slug,name,customization")
    .eq("active", true).in("slug", [...ACCOUNT_PRODUCT_SLUGS]);
  if (error) throw new Error(`Product catalog lookup failed: ${error.message}`);
  const eligible = (products ?? []).filter((product) =>
    ACCOUNT_PRODUCT_SLUGS.some((slug) => slug === product.slug)
    && isProductTemplateReady(product.customization)
    && isProductCustomerCopyReady(product.customization));
  if (!eligible.length) return [];
  const { data: variants, error: variantError } = await supabase.from("product_variants")
    .select("product_id,price_cents,currency")
    .in("product_id", eligible.map((product) => product.id)).eq("active", true);
  if (variantError) throw new Error(`Product variant lookup failed: ${variantError.message}`);
  return eligible.flatMap((product) => {
    const activeVariants = (variants ?? []).filter((variant) => variant.product_id === product.id
      && Number.isFinite(variant.price_cents) && typeof variant.currency === "string");
    const customization = product.customization && typeof product.customization === "object" && !Array.isArray(product.customization)
      ? product.customization as Record<string, unknown> : {};
    return activeVariants.length ? [{ slug: product.slug as ActiveDraftProduct["slug"],
      name: product.name, variants: activeVariants.map((variant) => ({ price_cents: variant.price_cents, currency: variant.currency })),
      mockupTemplateIds: Array.isArray(customization.mockupTemplateIds)
        ? customization.mockupTemplateIds.filter((item): item is string => typeof item === "string") : [] }] : [];
  });
}
