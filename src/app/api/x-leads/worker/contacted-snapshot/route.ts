import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isAuthorizedXLeadWorker } from "@/lib/x-lead-worker-auth";

export const runtime = "nodejs";

/** Fail closed: an incomplete contacted list must not authorize a paid probe. */
export async function GET(request: Request) {
  if (!isAuthorizedXLeadWorker(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const leads: Array<{ post_id: string | null; x_handle: string | null; targeting_data: unknown }> = [];
  const replies: Array<{ target_post_url: string | null }> = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error } = await supabase.from("x_leads")
      .select("post_id,x_handle,targeting_data")
      .in("selection_status", ["contacted", "suppressed"]).order("id")
      .range(offset, offset + 499);
    if (error || !data) return NextResponse.json({ error: "Contacted snapshot unavailable." }, { status: 503 });
    leads.push(...data);
    if (data.length < 500) break;
    if (offset === 9500) return NextResponse.json({ error: "Contacted snapshot exceeded safe bound." }, { status: 503 });
  }
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error } = await supabase.from("x_reply_jobs")
      .select("target_post_url").in("status", ["sent", "uncertain"])
      .order("id").range(offset, offset + 499);
    if (error || !data) return NextResponse.json({ error: "Reply snapshot unavailable." }, { status: 503 });
    replies.push(...data);
    if (data.length < 500) break;
    if (offset === 9500) return NextResponse.json({ error: "Reply snapshot exceeded safe bound." }, { status: 503 });
  }
  const postIds = new Set<string>();
  const handles = new Set<string>();
  const authorIds = new Set<string>();
  for (const lead of leads) {
    if (lead.post_id) postIds.add(String(lead.post_id));
    if (lead.x_handle) handles.add(String(lead.x_handle).toLowerCase().replace(/^@/, ""));
    const targeting = lead.targeting_data && typeof lead.targeting_data === "object" && !Array.isArray(lead.targeting_data)
      ? lead.targeting_data as Record<string, unknown> : {};
    const authorId = targeting.demand_author_id ?? targeting.author_id ?? targeting.authorId ?? targeting.x_author_id;
    if (typeof authorId === "string" && /^\d+$/.test(authorId)) authorIds.add(authorId);
  }
  for (const reply of replies) {
    const url = String(reply.target_post_url ?? "");
    const match = /\/status\/(\d+)/.exec(url);
    if (match) postIds.add(match[1]);
    const handle = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,50})\/status\/\d+/.exec(url);
    if (handle) handles.add(handle[1].toLowerCase());
  }
  return NextResponse.json({ snapshot_at: new Date().toISOString(),
    post_ids: [...postIds], author_ids: [...authorIds], handles: [...handles],
    source_counts: { contacted_leads: leads.length, sent_or_uncertain_replies: replies.length } });
}
