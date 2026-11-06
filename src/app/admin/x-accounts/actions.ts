"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { getXReplyWorkerSecret } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { encryptProxyUrl, getProxyDisplayHost } from "@/lib/x-proxy-crypto";

const PAGE_PATH = "/admin/x-accounts";
const accountKeySchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/);
const xHandleSchema = z.string().trim().regex(/^@?[A-Za-z0-9_]{1,15}$/).transform((value) => value.replace(/^@/, ""));
const shortText = z.string().trim().min(1).max(500);
const idSchema = z.string().uuid();
const copyStyleSchema = z.enum(["warm", "playful", "concise"]);
const networkModeSchema = z.enum(["vpn_direct", "fixed_proxy"]);
const countrySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);

function serviceClient() {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端连接尚未配置。");
  return supabase;
}

function proxySecret() {
  const secret = getXReplyWorkerSecret();
  if (!secret) throw new Error("X_REPLY_WORKER_SECRET 尚未配置，不能安全保存代理。");
  return secret;
}

function accountPayload(formData: FormData) {
  return {
    account_key: accountKeySchema.parse(String(formData.get("accountKey") ?? "")),
    expected_x_handle: xHandleSchema.parse(String(formData.get("expectedXHandle") ?? "")),
    display_name: z.string().trim().min(1).max(80).parse(String(formData.get("displayName") ?? "")),
    positioning: shortText.parse(String(formData.get("positioning") ?? "")),
    audience: shortText.parse(String(formData.get("audience") ?? "")),
    voice: shortText.parse(String(formData.get("voice") ?? "")),
    topics: String(formData.get("topics") ?? "").split(/[,，\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 12),
    prohibited_topics: z.string().trim().max(500).parse(String(formData.get("prohibitedTopics") ?? "")),
    daily_limit: z.coerce.number().int().min(1).max(20).parse(formData.get("dailyLimit")),
    copy_style: copyStyleSchema.parse(String(formData.get("copyStyle") ?? "")),
    copy_variation_notes: z.string().trim().max(500).parse(String(formData.get("copyVariationNotes") ?? "")),
    executor_id: z.string().trim().min(1).max(120).parse(String(formData.get("executorId") ?? "")),
    network_mode: networkModeSchema.parse(String(formData.get("networkMode") ?? "")),
    require_daily_first_confirmation: String(formData.get("requireDailyFirstConfirmation") ?? "") === "true",
    active: String(formData.get("active") ?? "") === "true",
  };
}

function proxyPayload(proxyUrl: string, formData: FormData) {
  return {
    encrypted_url: encryptProxyUrl(proxyUrl, proxySecret()),
    display_host: getProxyDisplayHost(proxyUrl),
    expected_country: countrySchema.parse(String(formData.get("expectedCountry") ?? "US")),
    expected_region: z.string().trim().max(100).parse(String(formData.get("expectedRegion") ?? "")),
    status: "pending",
    egress_ip: null,
    last_tested_at: null,
    last_error: null,
  };
}

export async function createXAccount(formData: FormData) {
  const user = await requireAdmin(PAGE_PATH);
  const supabase = serviceClient();
  const payload = accountPayload(formData);
  const proxyValue = String(formData.get("proxyUrl") ?? "").trim();
  const proxyUrl = payload.network_mode === "fixed_proxy"
    ? z.string().min(1).max(2048).parse(proxyValue)
    : null;
  const { data: account, error } = await supabase.from("x_reply_accounts").insert({
    ...payload,
    created_by: user.id,
  }).select("id").single();
  if (error || !account) throw new Error(error?.code === "23505" ? "该 x-use 账号标识已经存在。" : error?.message ?? "账号创建失败。");

  if (proxyUrl) {
    const { error: proxyError } = await supabase.from("x_reply_account_proxies").insert({
      account_id: account.id,
      ...proxyPayload(proxyUrl, formData),
    });
    if (proxyError) {
      await supabase.from("x_reply_accounts").delete().eq("id", account.id);
      throw new Error(proxyError.message);
    }
  }
  revalidatePath(PAGE_PATH);
  revalidatePath("/admin/x-auto-posts");
  redirect(`${PAGE_PATH}?notice=created`);
}

export async function updateXAccount(formData: FormData) {
  await requireAdmin(PAGE_PATH);
  const supabase = serviceClient();
  const accountId = idSchema.parse(String(formData.get("accountId") ?? ""));
  const payload = accountPayload(formData);
  const proxyUrl = String(formData.get("proxyUrl") ?? "").trim();
  const { data: existingProxy, error: existingProxyError } = await supabase.from("x_reply_account_proxies")
    .select("account_id").eq("account_id", accountId).maybeSingle();
  if (existingProxyError) throw new Error(existingProxyError.message);
  if (payload.network_mode === "fixed_proxy" && !proxyUrl && !existingProxy) {
    throw new Error("固定代理模式必须配置一个非轮换代理 URL。");
  }
  const { data: updated, error } = await supabase.from("x_reply_accounts")
    .update({
      ...payload,
      verification_status: "unverified",
      verification_requested_at: null,
      verification_started_at: null,
      verification_completed_at: null,
      verified_x_handle: null,
      verified_egress_ip: null,
      verification_error: null,
    })
    .eq("id", accountId)
    .select("id")
    .maybeSingle();
  if (error || !updated) throw new Error(error?.message ?? "账号不存在或状态已经变化。");

  if (proxyUrl) {
    const { error: proxyError } = await supabase.from("x_reply_account_proxies").upsert({
      account_id: accountId,
      ...proxyPayload(proxyUrl, formData),
    }, { onConflict: "account_id" });
    if (proxyError) throw new Error(proxyError.message);
  } else if (payload.network_mode === "fixed_proxy" && existingProxy) {
    const { error: proxyMetaError } = await supabase.from("x_reply_account_proxies").update({
      expected_country: countrySchema.parse(String(formData.get("expectedCountry") ?? "US")),
      expected_region: z.string().trim().max(100).parse(String(formData.get("expectedRegion") ?? "")),
    }).eq("account_id", accountId);
    if (proxyMetaError) throw new Error(proxyMetaError.message);
  }
  revalidatePath(PAGE_PATH);
  revalidatePath("/admin/x-auto-posts");
  redirect(`${PAGE_PATH}?notice=updated`);
}

export async function lockCurrentVpnEgress(formData: FormData) {
  await requireAdmin(PAGE_PATH);
  const supabase = serviceClient();
  const accountId = idSchema.parse(String(formData.get("accountId") ?? ""));
  const { data: account, error: accountError } = await supabase.from("x_reply_accounts")
    .select("id,executor_id,network_mode")
    .eq("id", accountId)
    .maybeSingle();
  if (accountError || !account) throw new Error(accountError?.message ?? "账号不存在。");
  if (account.network_mode !== "vpn_direct") throw new Error("只有 VPN 直连模式可以锁定执行器出口。");
  if (!account.executor_id) throw new Error("请先绑定执行器。");
  const { data: worker, error: workerError } = await supabase.from("x_reply_workers")
    .select("current_egress_ip,network_probe_status,last_seen_at")
    .eq("executor_id", account.executor_id)
    .gte("last_seen_at", new Date(Date.now() - 5 * 60_000).toISOString())
    .maybeSingle();
  if (workerError || !worker) throw new Error(workerError?.message ?? "绑定执行器最近五分钟没有心跳。");
  if (worker.network_probe_status !== "healthy" || !worker.current_egress_ip) {
    throw new Error("Patchright 浏览器尚未报告可确认的 VPN 出口 IP。");
  }
  const { data: updated, error } = await supabase.from("x_reply_accounts")
    .update({ expected_egress_ip: worker.current_egress_ip })
    .eq("id", accountId)
    .eq("network_mode", "vpn_direct")
    .select("id")
    .maybeSingle();
  if (error || !updated) throw new Error(error?.message ?? "出口 IP 锁定失败，请刷新后重试。");
  revalidatePath(PAGE_PATH);
  revalidatePath("/admin/x-auto-posts");
  redirect(`${PAGE_PATH}?notice=vpn-locked`);
}

export async function requestXAccountMappingVerification(formData: FormData) {
  await requireAdmin(PAGE_PATH);
  const supabase = serviceClient();
  const accountId = idSchema.parse(String(formData.get("accountId") ?? ""));
  const { data: account, error: accountError } = await supabase.from("x_reply_accounts")
    .select("id,executor_id,expected_x_handle,network_mode,expected_egress_ip,x_reply_account_proxies(account_id)")
    .eq("id", accountId)
    .eq("active", true)
    .maybeSingle();
  if (accountError || !account) throw new Error(accountError?.message ?? "账号不存在或已经停用。");
  if (!account.executor_id) throw new Error("请先绑定执行器。");
  if (!account.expected_x_handle) throw new Error("请先填写期望的 X 用户名。");
  const proxy = Array.isArray(account.x_reply_account_proxies) ? account.x_reply_account_proxies[0] : account.x_reply_account_proxies;
  if (account.network_mode === "vpn_direct" && !account.expected_egress_ip) throw new Error("请先锁定 VPN 出口 IP。");
  if (account.network_mode === "fixed_proxy" && !proxy) throw new Error("请先配置固定代理。");

  const requestedAt = new Date().toISOString();
  const { data: updated, error } = await supabase.from("x_reply_accounts").update({
    verification_status: "pending",
    verification_requested_at: requestedAt,
    verification_started_at: null,
    verification_completed_at: null,
    verified_x_handle: null,
    verified_egress_ip: null,
    verification_error: null,
  }).eq("id", accountId).select("id").maybeSingle();
  if (error || !updated) throw new Error(error?.message ?? "验证任务创建失败。");
  revalidatePath(PAGE_PATH);
  redirect(`${PAGE_PATH}?notice=verification-requested`);
}

export async function deleteXAccount(formData: FormData) {
  await requireAdmin(PAGE_PATH);
  const supabase = serviceClient();
  const accountId = idSchema.parse(String(formData.get("accountId") ?? ""));
  const [{ count: automaticCount, error: automaticError }, { count: manualCount, error: manualError }] = await Promise.all([
    supabase.from("x_reply_jobs").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    supabase.from("x_manual_posts").select("id", { count: "exact", head: true }).eq("account_id", accountId),
  ]);
  if (automaticError || manualError) throw new Error(automaticError?.message ?? manualError?.message);
  if ((automaticCount ?? 0) + (manualCount ?? 0) > 0) {
    redirect(`${PAGE_PATH}?notice=in-use`);
  }
  const { data: deleted, error } = await supabase.from("x_reply_accounts")
    .delete()
    .eq("id", accountId)
    .select("id")
    .maybeSingle();
  if (error || !deleted) throw new Error(error?.message ?? "账号不存在或已经删除。");
  revalidatePath(PAGE_PATH);
  revalidatePath("/admin/x-auto-posts");
  redirect(`${PAGE_PATH}?notice=deleted`);
}
