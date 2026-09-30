"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTemuStatusLabel } from "@/lib/temu";
import { TEMU_PROCUREMENT_PRODUCT } from "@/lib/temu-procurement";
import {
  getNextFulfillmentStatus,
  INTERNAL_FULFILLMENT_LABELS,
} from "@/lib/temu-purchase";
import type { FulfillmentStatus, TemuOrderStatus } from "@/lib/types";
import { adminStatusSchema } from "@/lib/validation";

const jobIdSchema = z.string().uuid();
const orderNumberSchema = z.string().trim().min(4).max(120);

export async function refreshTemuJobConfiguration(formData: FormData) {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const jobId = jobIdSchema.parse(String(formData.get("jobId") ?? ""));
  const { error } = await supabase
    .from("temu_purchase_jobs")
    .update({
      status: "ready_for_payment",
      product_url: TEMU_PROCUREMENT_PRODUCT.productUrl,
      goods_id: TEMU_PROCUREMENT_PRODUCT.goodsId,
      sku_id: null,
      expected_amount_cents: null,
      currency: TEMU_PROCUREMENT_PRODUCT.currency,
      last_error_code: null,
      last_error_message: null,
    })
    .eq("id", jobId)
    .eq("status", "configuration_required");

  if (error) throw new Error(error.message);
  revalidatePath("/admin/temu-purchases");
}

export async function returnTemuJobToQueue(formData: FormData) {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const jobId = jobIdSchema.parse(String(formData.get("jobId") ?? ""));
  const { data: job, error: readError } = await supabase
    .from("temu_purchase_jobs")
    .select("status")
    .eq("id", jobId)
    .maybeSingle();

  if (readError || !job) {
    throw new Error(readError?.message ?? "Purchase job not found.");
  }

  if (job.status === "submit_uncertain" || job.status === "temu_bound") {
    throw new Error(
      "This job cannot be retried automatically. Verify the Temu order first.",
    );
  }

  const { error } = await supabase
    .from("temu_purchase_jobs")
    .update({
      status: "ready_for_payment",
      worker_id: null,
      claimed_at: null,
      last_error_code: null,
      last_error_message: null,
    })
    .eq("id", jobId);

  if (error) throw new Error(error.message);
  revalidatePath("/admin/temu-purchases");
}

export async function bindManualTemuOrder(formData: FormData) {
  const user = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const jobId = jobIdSchema.parse(String(formData.get("jobId") ?? ""));
  const parentOrderSn = orderNumberSchema.parse(
    String(formData.get("temuParentOrderSn") ?? ""),
  );
  const rawOrderSn = String(formData.get("temuOrderSn") ?? "").trim();
  const orderSn = rawOrderSn ? orderNumberSchema.parse(rawOrderSn) : null;

  const { data: job, error: readError } = await supabase
    .from("temu_purchase_jobs")
    .select("id,order_id,status,temu_parent_order_sn,temu_order_sn")
    .eq("id", jobId)
    .maybeSingle();
  if (readError || !job) {
    throw new Error(readError?.message ?? "Purchase job not found.");
  }
  if (job.status === "canceled") {
    throw new Error("A canceled purchase job cannot be bound.");
  }
  if (
    job.status === "temu_bound" &&
    (job.temu_parent_order_sn !== parentOrderSn || job.temu_order_sn !== orderSn)
  ) {
    throw new Error("This purchase job is already bound to another Temu order.");
  }
  if (job.status === "temu_bound") {
    return;
  }

  const now = new Date().toISOString();
  const { error: orderError } = await supabase
    .from("orders")
    .update({
      fulfillment_status: "production",
      sales_channel: "temu",
      temu_parent_order_sn: parentOrderSn,
      temu_order_sn: orderSn,
      temu_status: "UN_SHIPPING",
      temu_status_label: getTemuStatusLabel("UN_SHIPPING"),
      temu_last_synced_at: now,
      temu_raw: { source: "manual_admin_binding" },
    })
    .eq("id", job.order_id);
  if (orderError) throw new Error(orderError.message);

  const { error: jobError } = await supabase
    .from("temu_purchase_jobs")
    .update({
      status: "temu_bound",
      temu_parent_order_sn: parentOrderSn,
      temu_order_sn: orderSn,
      submitted_at: now,
      verified_at: now,
      worker_id: null,
      claimed_at: null,
      last_error_code: null,
      last_error_message: null,
    })
    .eq("id", job.id);
  if (jobError) throw new Error(jobError.message);

  const { error: eventError } = await supabase
    .from("order_status_events")
    .upsert(
      {
        order_id: job.order_id,
        status: "production",
        changed_by: user.id,
        note: `Temu order ${parentOrderSn} was manually verified and bound.`,
        external_event_id: `temu-bound:${parentOrderSn}`,
      },
      { onConflict: "external_event_id", ignoreDuplicates: true },
    );
  if (eventError) throw new Error(eventError.message);

  revalidatePath("/admin/temu-purchases");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${job.order_id}`);
  revalidatePath(`/orders/${job.order_id}`);
}

export async function advanceManualFulfillmentStatus(formData: FormData) {
  const user = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const orderId = jobIdSchema.parse(String(formData.get("orderId") ?? ""));
  const requestedStatus = adminStatusSchema.parse(
    String(formData.get("status") ?? ""),
  );

  const { data: order, error: readError } = await supabase
    .from("orders")
    .select("id,fulfillment_status,temu_parent_order_sn")
    .eq("id", orderId)
    .maybeSingle();

  if (readError || !order) {
    throw new Error(readError?.message ?? "Order not found.");
  }

  const currentStatus = order.fulfillment_status as FulfillmentStatus;
  const nextStatus = getNextFulfillmentStatus(currentStatus);

  if (nextStatus !== requestedStatus) {
    throw new Error("订单状态已变化，请刷新页面后再操作。");
  }

  if (requestedStatus === "production" && !order.temu_parent_order_sn) {
    throw new Error("请先录入 Temu 订单号并确认已下单。");
  }

  const temuStatus: TemuOrderStatus =
    requestedStatus === "shipped" ? "SHIPPED" : "UN_SHIPPING";
  const now = new Date().toISOString();
  const { data: updatedOrder, error: updateError } = await supabase
    .from("orders")
    .update({
      fulfillment_status: requestedStatus,
      temu_status: temuStatus,
      temu_status_label: getTemuStatusLabel(temuStatus),
      temu_last_synced_at: now,
    })
    .eq("id", orderId)
    .eq("fulfillment_status", currentStatus)
    .select("id")
    .maybeSingle();

  if (updateError || !updatedOrder) {
    throw new Error(updateError?.message ?? "订单状态已变化，请刷新后重试。");
  }

  const { error: eventError } = await supabase
    .from("order_status_events")
    .insert({
      order_id: orderId,
      status: requestedStatus,
      changed_by: user.id,
      note: `管理员手动推进真实履约状态：${INTERNAL_FULFILLMENT_LABELS[requestedStatus]}。`,
    });

  if (eventError) throw new Error(eventError.message);

  revalidatePath("/admin/temu-purchases");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}
