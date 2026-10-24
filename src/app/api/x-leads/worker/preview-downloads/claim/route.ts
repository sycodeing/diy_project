import { NextResponse } from "next/server";
import { z } from "zod";
import { getMarketingReplyPreviewUrl } from "@/lib/marketing";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isAuthorizedXLeadWorker } from "@/lib/x-lead-worker-auth";

export const runtime = "nodejs";

const requestSchema = z.object({ workerId: z.string().trim().min(1).max(120) });

export async function POST(request: Request) {
  if (!isAuthorizedXLeadWorker(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid worker heartbeat." }, { status: 400 });
  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { error: recoveryError } = await supabase.from("x_manual_posts").update({
    preview_download_status: "pending",
    preview_download_worker_id: null,
    preview_download_error: "本机下载超时，任务已自动重新排队。",
  }).eq("preview_download_status", "processing").lt("preview_download_requested_at", staleBefore);
  if (recoveryError) return NextResponse.json({ error: recoveryError.message }, { status: 500 });

  const { data: queued, error: readError } = await supabase.from("x_manual_posts")
    .select("id,preview_download_path,x_leads(marketing_links!x_leads_marketing_link_id_fkey(source_hash,expires_at))")
    .eq("preview_download_status", "pending")
    .neq("status", "discarded")
    .order("preview_download_requested_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!queued) return new Response(null, { status: 204 });

  const { data: claimed, error: claimError } = await supabase.from("x_manual_posts").update({
    preview_download_status: "processing",
    preview_download_worker_id: parsed.data.workerId,
    preview_download_error: null,
  }).eq("id", queued.id).eq("preview_download_status", "pending").select("id").maybeSingle();
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!claimed) return new Response(null, { status: 204 });

  const relation = queued.x_leads as unknown as { marketing_links: { source_hash: string; expires_at: string } | null } | null;
  if (!relation?.marketing_links) {
    await supabase.from("x_manual_posts").update({ preview_download_status: "failed", preview_download_error: "预览图记录不存在。" }).eq("id", queued.id);
    return new Response(null, { status: 204 });
  }
  const preview = await getMarketingReplyPreviewUrl(relation.marketing_links.source_hash, relation.marketing_links.expires_at);
  if (!preview) {
    await supabase.from("x_manual_posts").update({ preview_download_status: "failed", preview_download_error: "预览图签名链接生成失败。" }).eq("id", queued.id);
    return new Response(null, { status: 204 });
  }
  return NextResponse.json({ job: { id: queued.id, imageUrl: preview.url, existingLocalPath: queued.preview_download_path } });
}
