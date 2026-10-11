"use server";

import { createHash, createHmac, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { getAppUrl, getMarketingIngestSecret } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { createXLeadDrafts } from "@/lib/x-lead";

const leadIdSchema = z.uuid();

export async function generateXLeadMarketingLink(formData: FormData) {
  await requireAdmin("/admin/x-leads");
  const leadId = leadIdSchema.parse(String(formData.get("leadId") ?? ""));
  const supabase = getSupabaseServiceClient();
  const secret = getMarketingIngestSecret();
  if (!supabase || !secret) throw new Error("营销链接服务尚未配置。");

  const { data: lead, error } = await supabase
    .from("x_leads")
    .select("id,post_id,author_hash,x_handle,post_url,media_url,segment,lead_score,selection_status")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) throw new Error(error?.message ?? "X 用户不存在。");
  if (["rejected_targeting", "rejected", "suppressed"].includes(lead.selection_status)) {
    redirect("/admin/x-leads?notice=not-eligible");
  }

  const dateKey = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const campaign = `x_${lead.segment}_${dateKey}`;
  const channel = "direct_message";
  const variant = "admin_preview_v1";
  const sourceHash = createHmac("sha256", secret).update(`x-post:${lead.post_id}`).digest("hex");
  const linkCycle = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const material = `${lead.post_id}\n${campaign}\n${channel}\n${variant}\n${linkCycle}`;
  const idempotencyKey = `x-link:${createHash("sha256").update(material).digest("hex")}`;
  const payload = {
    campaign,
    channel,
    variant,
    sourceHash,
    sourceImageUrl: lead.media_url,
    xLead: {
      leadId: lead.id,
      authorHash: lead.author_hash,
      handle: lead.x_handle,
      postId: lead.post_id,
      postUrl: lead.post_url,
      segment: lead.segment,
      ...(lead.lead_score === null ? {} : { score: lead.lead_score }),
    },
  };
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(24).toString("base64url");
  const canonical = `${timestamp}\n${nonce}\n${idempotencyKey}\n${body}`;
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  const response = await fetch(`${getAppUrl()}/api/marketing/links`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-marketing-timestamp": timestamp,
      "x-marketing-nonce": nonce,
      "x-marketing-idempotency-key": idempotencyKey,
      "x-marketing-signature": signature,
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(115_000),
  });
  const result = await response.json().catch(() => null) as { url?: string; error?: string } | null;
  if (!response.ok || !result?.url) {
    throw new Error(result?.error ?? "生成专属链接或预览图失败，请稍后重试。");
  }

  const { data: marketingLink, error: linkError } = await supabase
    .from("marketing_links")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .single();
  if (linkError || !marketingLink) throw new Error(linkError?.message ?? "专属链接记录不存在。");
  const drafts = createXLeadDrafts(lead.segment, result.url);
  const { error: updateError } = await supabase.from("x_leads").update({
    marketing_link_id: marketingLink.id,
    consent_copy: drafts.consentCopy,
    public_copy: drafts.publicCopy,
    direct_message_copy: drafts.directMessageCopy,
  }).eq("id", lead.id);
  if (updateError) throw new Error(updateError.message);

  revalidatePath("/admin/x-leads");
  revalidatePath("/admin/marketing");
  redirect("/admin/x-leads?notice=generated");
}

