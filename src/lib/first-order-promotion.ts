import { cache } from "react";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const FIRST_ORDER_PROMOTION_KEY = "first_order";

export type FirstOrderPromotion = {
  key: string;
  productSlug: string;
  priceCents: number;
  currency: string;
};

export const getActiveFirstOrderPromotion = cache(async (userId?: string | null): Promise<FirstOrderPromotion | null> => {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("sales_promotions")
    .select("key,product_slug,price_cents,currency")
    .eq("key", FIRST_ORDER_PROMOTION_KEY)
    .eq("active", true)
    .maybeSingle();

  if (error) throw new Error(`Could not read first-order promotion: ${error.message}`);
  if (!data) return null;

  if (userId) {
    const { count, error: orderError } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("paid_at", "is", null);
    if (orderError) throw new Error(`Could not check first-order eligibility: ${orderError.message}`);
    if (count && count > 0) return null;
  }

  return {
    key: data.key,
    productSlug: data.product_slug,
    priceCents: data.price_cents,
    currency: data.currency,
  };
});

export function promotionalPrice(
  regularPriceCents: number,
  currency: string,
  productSlug: string,
  promotion: FirstOrderPromotion | null,
) {
  return promotion?.productSlug === productSlug &&
    promotion.currency.toLowerCase() === currency.toLowerCase() &&
    promotion.priceCents < regularPriceCents
    ? promotion.priceCents
    : regularPriceCents;
}
