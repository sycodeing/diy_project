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
const shortText = z.string().trim().min(1).max(500);
const idSchema = z.string().uuid();
const copyStyleSchema = z.enum(["warm", "playful", "concise"]);
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
    display_name: z.string().trim().min(1).max(80).parse(String(formData.get("displayName") ?? "")),
    positioning: shortText.parse(String(formData.get("positioning") ?? "")),
    audience: shortText.parse(String(formData.get("audience") ?? "")),
    voice: shortText.parse(String(formData.get("voice") ?? "")),
    topics: String(formData.get("topics") ?? "").split(/[,，\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 12),
    prohibited_topics: z.string().trim().max(500).parse(String(formData.get("prohibitedTopics") ?? "")),
    daily_limit: z.coerce.number().int().min(1).max(20).parse(formData.get("dailyLimit")),
    copy_style: copyStyleSchema.parse(String(formData.get("copyStyle") ?? "")),
    copy_variation_notes: z.string().trim().max(500).parse(String(formData.get("copyVariationNotes") ?? "")),
    bitbrowser_window_id: z.string().trim().max(120).nullable().parse(String(formData.get("bitbrowserWindowId") ?? "").trim() || null),
    bitbrowser_window_name: z.string().trim().max(120).parse(String(formData.get("bitbrowserWindowName") ?? "")),
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
  const proxyUrl = z.string().trim().min(1).max(2048).parse(String(formData.get("proxyUrl") ?? ""));
  const { data: account, error } = await supabase.from("x_reply_accounts").insert({
    ...accountPayload(formData),
    created_by: user.id,
  }).select("id").single();
  if (error || !account) throw new Error(error?.code === "23505" ? "该 x-use 账号标识已经存在。" : error?.message ?? "账号创建失败。");

  const { error: proxyError } = await supabase.from("x_reply_account_proxies").insert({
    account_id: account.id,
    ...proxyPayload(proxyUrl, formData),
  });
  if (proxyError) {
    await supabase.from("x_reply_accounts").delete().eq("id", account.id);
    throw new Error(proxyError.message);
  }
  revalidatePath(PAGE_PATH);
  revalidatePath("/admin/x-auto-posts");
  redirect(`${PAGE_PATH}?notice=created`);
}

export async function updateXAccount(formData: FormData) {
  await requireAdmin(PAGE_PATH);
  const supabase = serviceClient();
  const accountId = idSchema.parse(String(formData.get("accountId") ?? ""));
  const { data: updated, error } = await supabase.from("x_reply_accounts")
    .update(accountPayload(formData))
    .eq("id", accountId)
    .select("id")
    .maybeSingle();
  if (error || !updated) throw new Error(error?.message ?? "账号不存在或状态已经变化。");

  const proxyUrl = String(formData.get("proxyUrl") ?? "").trim();
  if (proxyUrl) {
    const { error: proxyError } = await supabase.from("x_reply_account_proxies").upsert({
      account_id: accountId,
      ...proxyPayload(proxyUrl, formData),
    }, { onConflict: "account_id" });
    if (proxyError) throw new Error(proxyError.message);
  } else {
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
