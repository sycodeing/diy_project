"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTemuStatusLabel } from "@/lib/temu";
import { adminStatusSchema, temuStatusSchema } from "@/lib/validation";

export async function updateOrderStatus(formData: FormData) {
  const user = await requireAdmin();
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const orderId = String(formData.get("orderId") ?? "");
  const status = adminStatusSchema.parse(String(formData.get("status") ?? ""));
  const temuStatus = temuStatusSchema.parse(
    String(formData.get("temuStatus") ?? "NOT_SUBMITTED"),
  );
  const temuParentOrderSn =
    String(formData.get("temuParentOrderSn") ?? "").trim() || null;
  const temuOrderSn = String(formData.get("temuOrderSn") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").slice(0, 240);

  const { error } = await supabase
    .from("orders")
    .update({
      fulfillment_status: status,
      sales_channel: temuParentOrderSn ? "temu" : "direct",
      temu_parent_order_sn: temuParentOrderSn,
      temu_order_sn: temuOrderSn,
      temu_status: temuStatus,
      temu_status_label: getTemuStatusLabel(temuStatus),
      temu_last_synced_at:
        temuStatus !== "NOT_SUBMITTED" ? new Date().toISOString() : null,
    })
    .eq("id", orderId);

  if (error) {
    throw new Error(error.message);
  }

  await supabase.from("order_status_events").insert({
    order_id: orderId,
    status,
    changed_by: user.id,
    note:
      note ||
      `Admin updated local status and Temu mirror to ${getTemuStatusLabel(
        temuStatus,
      )}.`,
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}`);
}
