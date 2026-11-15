"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { FIRST_ORDER_PROMOTION_KEY } from "@/lib/first-order-promotion";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function setFirstOrderPromotionActive(formData: FormData) {
  await requireAdmin("/admin/promotions");
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端配置缺失。");

  const active = formData.get("active") === "true";
  const { data, error } = await supabase
    .from("sales_promotions")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("key", FIRST_ORDER_PROMOTION_KEY)
    .select("key")
    .maybeSingle();

  if (error || !data) throw new Error(error?.message ?? "活动不存在。");
  revalidatePath("/", "layout");
  revalidatePath("/admin/promotions");
}
