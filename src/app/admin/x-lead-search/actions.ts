"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  searchConfigurationSchema,
  demandSearchConfigurationSchema,
  type XSearchConfiguration,
} from "@/lib/x-lead";
import { supportsAccountFirst, supportsConsumerRecall, supportsDiscussionSearch, supportsEngagementRecall, supportsPurchaseRecall } from "@/lib/x-lead-worker-version";

export async function runAccountFirstSearch(formData: FormData) {
  const user = await requireAdmin("/admin/x-lead-search");
  const rawSeed = String(formData.get("seedPost") ?? "").trim();
  const match = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/(\d{5,30})(?:[/?#].*)?$/.exec(rawSeed);
  const seedPostId = match?.[1] ?? (/^\d{5,30}$/.test(rawSeed) ? rawSeed : "");
  const seedVerificationNote = String(formData.get("seedVerificationNote") ?? "").trim();
  if (!seedPostId || seedVerificationNote.length < 12 || seedVerificationNote.length > 1000) {
    throw new Error("请填写已核实的原帖链接或 ID，并说明核实依据（12–1000 字）。");
  }
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端配置缺失。");
  const { data: worker, error: workerError } = await supabase.from("x_lead_workers")
    .select("worker_version,last_seen_at").eq("status", "online")
    .order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
  if (workerError) throw new Error(workerError.message);
  if (!worker || Date.now() - new Date(worker.last_seen_at).getTime() > 120_000
      || !supportsAccountFirst(worker.worker_version ?? undefined)) {
    throw new Error("账号证据模式需要在线的 1.19.0 或更高版本发现执行器。");
  }
  const { data: active, error: activeError } = await supabase.from("x_lead_search_jobs")
    .select("id").in("status", ["queued", "running"]).limit(1).maybeSingle();
  if (activeError) throw new Error(activeError.message);
  if (active) redirect("/admin/x-lead-search?notice=active");
  const { error } = await supabase.from("x_lead_search_jobs").insert({
    trigger_type: "manual", status: "queued", created_by: user.id,
    configuration: { discoveryMode: "account_first", classifierVersion: "account-first-v1",
      seedPostId, seedVerificationNote, maxAccounts: 4, maxCredits: 1800 },
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/x-lead-search");
  redirect("/admin/x-lead-search?notice=account-queued");
}

export async function runEngagementLeadSearch() {
  const user = await requireAdmin("/admin/x-lead-search");
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端配置缺失。");
  const { data: worker, error: workerError } = await supabase.from("x_lead_workers")
    .select("worker_version,last_seen_at").eq("status", "online")
    .order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
  if (workerError) throw new Error(workerError.message);
  if (!worker || Date.now() - new Date(worker.last_seen_at).getTime() > 120_000
      || !supportsEngagementRecall(worker.worker_version ?? undefined)) {
    throw new Error("对话来源召回需要在线的 1.18.3 或更高版本发现执行器。");
  }
  const { data: active, error: activeError } = await supabase.from("x_lead_search_jobs")
    .select("id").in("status", ["queued", "running"]).limit(1).maybeSingle();
  if (activeError) throw new Error(activeError.message);
  if (active) redirect("/admin/x-lead-search?notice=active");
  const { error } = await supabase.from("x_lead_search_jobs").insert({
    trigger_type: "manual", status: "queued", created_by: user.id,
    configuration: { discoveryMode: "engagement_recall", queryRevision: "engagement-seed-v2-local-reply-count", lookbackDays: 3,
      searchPages: 3, maxReplyPages: 2, maxCredits: 1800 },
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/x-lead-search");
  redirect("/admin/x-lead-search?notice=engagement-queued");
}

export async function runConsumerLeadSearch(formData: FormData) {
  const user = await requireAdmin("/admin/x-lead-search");
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端配置缺失。");
  const { data: worker, error: workerError } = await supabase.from("x_lead_workers")
    .select("worker_version,last_seen_at").eq("status", "online")
    .order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
  if (workerError) throw new Error(workerError.message);
  if (!worker || Date.now() - new Date(worker.last_seen_at).getTime() > 120_000
      || !supportsConsumerRecall(worker.worker_version ?? undefined)) {
    throw new Error("生活场景召回需要在线的 1.17.3 或更高版本发现执行器。");
  }
  const { data: active, error: activeError } = await supabase.from("x_lead_search_jobs")
    .select("id").in("status", ["queued", "running"]).limit(1).maybeSingle();
  if (activeError) throw new Error(activeError.message);
  if (active) redirect("/admin/x-lead-search?notice=active");
  const maxPages = Number(formData.get("maxPages") ?? 6);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 6) {
    throw new Error("本轮查询页数必须为 1–6。");
  }
  const { error } = await supabase.from("x_lead_search_jobs").insert({
    trigger_type: "manual", status: "queued", created_by: user.id,
    configuration: { discoveryMode: "consumer_recall", lookbackDays: 3, maxPages },
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/x-lead-search");
  redirect("/admin/x-lead-search?notice=consumer-queued");
}

export async function runRecallLeadSearch(formData: FormData) {
  const user = await requireAdmin("/admin/x-lead-search");
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端配置缺失。");
  const { data: worker, error: workerError } = await supabase.from("x_lead_workers")
    .select("worker_version,last_seen_at").eq("status", "online")
    .order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
  if (workerError) throw new Error(workerError.message);
  if (!worker || Date.now() - new Date(worker.last_seen_at).getTime() > 120_000
      || !supportsPurchaseRecall(worker.worker_version ?? undefined)) {
    throw new Error("消费场景召回需要在线的 1.15.0 或更高版本发现执行器。");
  }
  const { data: active, error: activeError } = await supabase.from("x_lead_search_jobs")
    .select("id").in("status", ["queued", "running"]).limit(1).maybeSingle();
  if (activeError) throw new Error(activeError.message);
  if (active) redirect("/admin/x-lead-search?notice=active");
  const maxPages = Number(formData.get("maxPages") ?? 2);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 8) {
    throw new Error("单次查询页数必须为 1–8。");
  }
  const { error } = await supabase.from("x_lead_search_jobs").insert({
    trigger_type: "manual", status: "queued", created_by: user.id,
    configuration: {
      discoveryMode: "purchase_recall", lookbackDays: 3,
      maxPages, targetNewPosts: 20, diagnoseControl: false,
    },
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/x-lead-search");
  redirect("/admin/x-lead-search?notice=recall-queued");
}

// Independent, bounded manual jobs. Never saves or enables the legacy schedule.
export async function runDemandLeadSearch(formData: FormData) {
  const user = await requireAdmin("/admin/x-lead-search");
  const configuration = demandSearchConfigurationSchema.parse({
    segments: formData.getAll("segments").map(String),
    resultLimit: Number(formData.get("resultLimit") ?? 60),
    qualifiedPerScene: Number(formData.get("qualifiedPerScene") ?? 20),
    lookbackDays: Number(formData.get("lookbackDays") ?? 7),
  });
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端配置缺失。");
  if (configuration.segments.includes("demand_discussion")) {
    const { data: worker, error: workerError } = await supabase.from("x_lead_workers")
      .select("worker_version,last_seen_at").eq("status", "online")
      .order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
    if (workerError) throw new Error(workerError.message);
    if (!worker || Date.now() - new Date(worker.last_seen_at).getTime() > 120_000
        || !supportsDiscussionSearch(worker.worker_version ?? undefined)) {
      throw new Error("商品讨论筛选需要在线的 1.12.0 或更高版本发现执行器。");
    }
  }
  const { data: active, error: activeError } = await supabase.from("x_lead_search_jobs")
    .select("id").in("status", ["queued", "running"]).limit(1).maybeSingle();
  if (activeError) throw new Error(activeError.message);
  if (active) redirect("/admin/x-lead-search?notice=active");
  const { error } = await supabase.from("x_lead_search_jobs").insert({
    trigger_type: "manual", status: "queued", configuration, created_by: user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/x-lead-search");
  redirect("/admin/x-lead-search?notice=demand-queued");
}

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
