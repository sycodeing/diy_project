import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppUrl, getMarketingIngestSecret } from "@/lib/env";
import { hashMarketingToken, safeHexEqual } from "@/lib/marketing";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const requestSchema = z.object({
  campaign: z.string().trim().min(1).max(100),
  channel: z.enum(["consent_reply", "public_reply", "direct_message"]),
  variant: z.string().trim().min(1).max(100),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceImageUrl: z.url().max(2048).refine((value) => value.startsWith("https://")),
});

export async function POST(request: Request) {
  const secret = getMarketingIngestSecret();
  const supabase = getSupabaseServiceClient();
  if (!secret || !supabase) {
    return NextResponse.json({ error: "Marketing ingestion is not configured." }, { status: 503 });
  }

  const timestamp = request.headers.get("x-marketing-timestamp") ?? "";
  const nonce = request.headers.get("x-marketing-nonce") ?? "";
  const idempotencyKey = request.headers.get("x-marketing-idempotency-key") ?? "";
  const signature = request.headers.get("x-marketing-signature") ?? "";
  const timestampSeconds = Number(timestamp);

  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > 300 ||
    !/^[a-zA-Z0-9_-]{16,128}$/.test(nonce) ||
    !/^[a-zA-Z0-9:_-]{16,160}$/.test(idempotencyKey)
  ) {
    return NextResponse.json({ error: "Invalid or expired authentication headers." }, { status: 401 });
  }

  const rawBody = await request.text();
  if (rawBody.length > 16_384) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }
  const canonical = `${timestamp}\n${nonce}\n${idempotencyKey}\n${rawBody}`;
  const expected = createHmac("sha256", secret).update(canonical).digest("hex");
  if (!safeHexEqual(signature, expected)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid marketing link payload." }, { status: 400 });
  }

  return createLink(parsed.data, idempotencyKey, nonce, timestampSeconds, secret, supabase);
}

async function createLink(
  payload: z.infer<typeof requestSchema>,
  idempotencyKey: string,
  nonce: string,
  timestampSeconds: number,
  secret: string,
  supabase: NonNullable<ReturnType<typeof getSupabaseServiceClient>>,
) {
  const { error: nonceError } = await supabase.from("marketing_ingest_nonces").insert({
    nonce,
    request_timestamp: new Date(timestampSeconds * 1000).toISOString(),
  });
  if (nonceError) {
    return NextResponse.json({ error: "Nonce has already been used." }, { status: 409 });
  }

  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from("marketing_ingest_nonces")
    .select("nonce", { count: "exact", head: true })
    .gte("created_at", oneMinuteAgo);
  if ((count ?? 0) > 60) {
    return NextResponse.json({ error: "Too many marketing link requests." }, { status: 429 });
  }

  const { data: existing } = await supabase
    .from("marketing_links")
    .select("id,token_hash,expires_at")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  const token = createHmac("sha256", secret)
    .update(`marketing-link:${idempotencyKey}`)
    .digest("base64url");
  if (existing) {
    if (existing.token_hash !== hashMarketingToken(token)) {
      return NextResponse.json(
        { error: "The ingestion secret changed; use a new idempotency key." },
        { status: 409 },
      );
    }
    return linkResponse(token, existing.expires_at, true);
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("marketing_links")
    .insert({
      token_hash: hashMarketingToken(token),
      idempotency_key: idempotencyKey,
      campaign: payload.campaign,
      channel: payload.channel,
      variant: payload.variant,
      source_hash: payload.sourceHash.toLowerCase(),
      source_image_url: payload.sourceImageUrl,
      expires_at: expiresAt,
    })
    .select("id,expires_at")
    .single();

  if (error || !data) {
    const { data: raced } = await supabase
      .from("marketing_links")
      .select("expires_at")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (raced) return linkResponse(token, raced.expires_at, true);
    return NextResponse.json({ error: "Could not create marketing link." }, { status: 500 });
  }

  // The deterministic HMAC token is returned but never persisted in plaintext.
  return linkResponse(token, data.expires_at, false);
}

function linkResponse(token: string, expiresAt: string, reused: boolean) {
  return NextResponse.json({
    url: `${getAppUrl()}/go/${token}`,
    expiresAt,
    reused,
  });
}
