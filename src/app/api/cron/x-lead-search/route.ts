import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const now = new Date();
  const { data: configs, error } = await supabase
    .from("x_lead_search_configs")
    .select("*")
    .eq("enabled", true)
    .lte("next_run_at", now.toISOString())
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let enqueued = 0;
  for (const config of configs ?? []) {
    const { data: active } = await supabase
      .from("x_lead_search_jobs")
      .select("id")
      .eq("config_id", config.id)
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle();

    if (!active) {
      const { error: insertError } = await supabase.from("x_lead_search_jobs").insert({
        config_id: config.id,
        trigger_type: "scheduled",
        status: "queued",
        configuration: {
          segments: config.segments,
          searchProduct: config.search_product,
          resultLimit: config.result_limit,
          lookbackDays: config.lookback_days,
          usRequired: config.us_required,
          usMinConfidence: config.us_min_confidence,
          intervalMinutes: config.interval_minutes,
        },
        created_by: config.created_by,
      });
      if (!insertError) enqueued += 1;
    }

    await supabase.from("x_lead_search_configs").update({
      last_enqueued_at: now.toISOString(),
      next_run_at: new Date(now.getTime() + config.interval_minutes * 60_000).toISOString(),
    }).eq("id", config.id);
  }

  return NextResponse.json({ checked: configs?.length ?? 0, enqueued });
}

