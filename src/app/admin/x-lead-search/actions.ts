"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  searchConfigurationSchema,
  type XSearchConfiguration,
} from "@/lib/x-lead";

function parseConfiguration(formData: FormData): XSearchConfiguration {
  return searchConfigurationSchema.parse({
    segments: formData.getAll("segments").map(String),
    searchProduct: String(formData.get("searchProduct") ?? "Latest"),
    resultLimit: Number(formData.get("resultLimit") ?? 40),
    lookbackDays: Number(formData.get("lookbackDays") ?? 30),
    usRequired: formData.get("usRequired") === "on",
    usMinConfidence: Number(formData.get("usMinConfidence") ?? 70),
    intervalMinutes: Number(formData.get("intervalMinutes") ?? 1440),
  });
}

function toDatabaseConfiguration(configuration: XSearchConfiguration) {
  return {
    segments: configuration.segments,
    search_product: configuration.searchProduct,
    result_limit: configuration.resultLimit,
    lookback_days: configuration.lookbackDays,
    us_required: configuration.usRequired,
    us_min_confidence: configuration.usMinConfidence,
    interval_minutes: configuration.intervalMinutes,
  };
}

export async function saveXLeadSearchConfiguration(formData: FormData) {
  const user = await requireAdmin("/admin/x-lead-search");
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端配置缺失。");

  const configuration = parseConfiguration(formData);
  const enabled = formData.get("scheduleEnabled") === "on";
  const now = Date.now();
  const nextRunAt = enabled
    ? new Date(now + configuration.intervalMinutes * 60_000).toISOString()
    : null;
  const { data: saved, error } = await supabase
    .from("x_lead_search_configs")
    .upsert(
      {
        config_key: "default",
        enabled,
        ...toDatabaseConfiguration(configuration),
        next_run_at: nextRunAt,
        created_by: user.id,
      },
      { onConflict: "config_key" },
    )
    .select("id")
    .single();
  if (error || !saved) throw new Error(error?.message ?? "筛选配置保存失败。");

  const intent = String(formData.get("intent") ?? "save");
  if (intent === "run") {
    const { data: active } = await supabase
      .from("x_lead_search_jobs")
      .select("id")
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle();
    if (active) redirect("/admin/x-lead-search?notice=active");

    const { error: jobError } = await supabase.from("x_lead_search_jobs").insert({
      config_id: saved.id,
      trigger_type: "manual",
      status: "queued",
      configuration,
      created_by: user.id,
    });
    if (jobError) throw new Error(jobError.message);
  }

  revalidatePath("/admin/x-lead-search");
  redirect(`/admin/x-lead-search?notice=${intent === "run" ? "queued" : "saved"}`);
}

