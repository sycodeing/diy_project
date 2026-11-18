"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function setRawReviewStatus(formData: FormData) {
  const user = await requireAdmin("/admin/x-leads?mode=raw_review");
  const postId = String(formData.get("postId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!/^\d{1,30}$/.test(postId) || !["unreviewed", "dismissed"].includes(status)) {
    throw new Error("无效的原始帖子审核操作。");
  }
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端配置缺失。");
  const { error } = await supabase.from("x_lead_raw_reviews").update({
    review_status: status, reviewed_by: user.id, reviewed_at: new Date().toISOString(),
  }).eq("post_id", postId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/x-leads");
}
