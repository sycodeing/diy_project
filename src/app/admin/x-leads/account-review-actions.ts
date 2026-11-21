"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function setAccountReviewStatus(formData: FormData) {
  const user = await requireAdmin("/admin/x-leads?mode=account_review");
  const authorId = String(formData.get("authorId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!/^\d{5,30}$/.test(authorId) || !["dismissed", "unreviewed"].includes(status)) {
    throw new Error("Invalid account review update");
  }
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("x_lead_account_reviews")
    .update({ review_status: status, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("author_id", authorId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/x-leads");
}
