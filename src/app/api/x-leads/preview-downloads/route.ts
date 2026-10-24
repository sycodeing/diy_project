import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const requestSchema = z.object({ taskId: z.string().uuid() });

export async function POST(request: Request) {
  await requireAdmin("/admin/x-manual-posts");
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid task." }, { status: 400 });
  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("x_manual_posts")
    .update({
      preview_download_status: "pending",
      preview_download_worker_id: null,
      preview_download_error: null,
      preview_download_requested_at: now,
      preview_downloaded_at: null,
    })
    .eq("id", parsed.data.taskId)
    .eq("preparation_status", "ready")
    .neq("status", "discarded")
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Preview is not ready." }, { status: 409 });
  return NextResponse.json({ ok: true }, { status: 202 });
}
