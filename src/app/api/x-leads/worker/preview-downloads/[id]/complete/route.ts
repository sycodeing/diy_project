import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isAuthorizedXLeadWorker } from "@/lib/x-lead-worker-auth";

export const runtime = "nodejs";

const requestSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  status: z.enum(["completed", "failed"]),
  localPath: z.string().trim().max(1000).nullable().optional(),
  errorMessage: z.string().trim().max(1000).nullable().optional(),
});

export async function POST(request: Request, context: RouteContext<"/api/x-leads/worker/preview-downloads/[id]/complete">) {
  if (!isAuthorizedXLeadWorker(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await context.params;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid worker result." }, { status: 400 });
  if (parsed.data.status === "completed" && !parsed.data.localPath) return NextResponse.json({ error: "Missing local path." }, { status: 400 });
  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const update = {
    preview_download_status: parsed.data.status,
    preview_download_error: parsed.data.status === "failed" ? (parsed.data.errorMessage ?? "本机下载失败。") : null,
    preview_downloaded_at: parsed.data.status === "completed" ? new Date().toISOString() : null,
    ...(parsed.data.status === "completed" ? { preview_download_path: parsed.data.localPath } : {}),
  };
  const { data, error } = await supabase.from("x_manual_posts").update(update)
    .eq("id", id)
    .neq("status", "discarded")
    .eq("preview_download_status", "processing")
    .eq("preview_download_worker_id", parsed.data.workerId)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Job is not owned by this worker." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
