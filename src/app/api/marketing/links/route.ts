import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppUrl, getMarketingIngestSecret } from "@/lib/env";
import { hashMarketingToken, safeHexEqual } from "@/lib/marketing";
import { createLegacyMarketingAlias, createMarketingLinkTokens } from "@/lib/marketing-token";
import { prepareMarketingPreviewCache } from "@/lib/marketing-preview-cache";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const requestSchema = z.object({
  campaign: z.string().trim().min(1).max(100),
  channel: z.enum(["consent_reply", "public_reply", "direct_message"]),
  variant: z.string().trim().min(1).max(100),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceImageUrl: z.url().max(2048).refine((value) => value.startsWith("https://")),
  previewMode: z.enum(["reply", "full"]).default("full"),
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
    .select("id,token_hash,short_token_hash,expires_at,source_hash,source_image_url")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  const tokens = createMarketingLinkTokens(secret, idempotencyKey);
  if (existing) {
    const legacyAlias = createLegacyMarketingAlias(existing.token_hash);
    const legacyMatches = existing.token_hash === hashMarketingToken(tokens.legacy);
    const preferredStored = existing.token_hash === hashMarketingToken(tokens.preferred)
      || existing.short_token_hash === hashMarketingToken(tokens.preferred);
    const legacyAliasStored = existing.short_token_hash === hashMarketingToken(legacyAlias);
    if (!legacyMatches && !preferredStored) {
      return NextResponse.json(
        { error: "The ingestion secret changed; use a new idempotency key." },
        { status: 409 },
      );
    }
    const returnedToken = preferredStored ? tokens.preferred : legacyAliasStored ? legacyAlias : tokens.preferred;
    if (!preferredStored && !legacyAliasStored) {
      const { error: aliasError } = await supabase.from("marketing_links").update({
        short_token_hash: hashMarketingToken(tokens.preferred),
      }).eq("id", existing.id);
      if (aliasError) return NextResponse.json({ error: "Could not create the short marketing link." }, { status: 500 });
    }
    const cacheReady = await prepareMarketingPreviewCache(
      existing.source_image_url ?? payload.sourceImageUrl,
      existing.source_hash,
      existing.expires_at,
      supabase,
      { replyOnly: payload.previewMode === "reply" },
    );
    return linkResponse(returnedToken, existing.expires_at, true, cacheReady);
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const token = tokens.preferred;
  const { data, error } = await supabase
    .from("marketing_links")
    .insert({
      token_hash: hashMarketingToken(token),
      short_token_hash: hashMarketingToken(token),
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
      .select("id,token_hash,short_token_hash,expires_at,source_hash,source_image_url")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (raced) {
      const legacyAlias = createLegacyMarketingAlias(raced.token_hash);
      const legacyMatches = raced.token_hash === hashMarketingToken(tokens.legacy);
      const preferredStored = raced.token_hash === hashMarketingToken(tokens.preferred)
        || raced.short_token_hash === hashMarketingToken(tokens.preferred);
      const legacyAliasStored = raced.short_token_hash === hashMarketingToken(legacyAlias);
      if (!legacyMatches && !preferredStored) {
        return NextResponse.json({ error: "The ingestion secret changed; use a new idempotency key." }, { status: 409 });
      }
      const returnedToken = preferredStored ? tokens.preferred : legacyAliasStored ? legacyAlias : tokens.preferred;
      if (!preferredStored && !legacyAliasStored) {
        const { error: aliasError } = await supabase.from("marketing_links").update({
          short_token_hash: hashMarketingToken(tokens.preferred),
        }).eq("id", raced.id);
        if (aliasError) return NextResponse.json({ error: "Could not create the short marketing link." }, { status: 500 });
      }
      const cacheReady = await prepareMarketingPreviewCache(
        raced.source_image_url ?? payload.sourceImageUrl,
        raced.source_hash,
        raced.expires_at,
        supabase,
      { replyOnly: payload.previewMode === "reply" },
      );
      return linkResponse(returnedToken, raced.expires_at, true, cacheReady);
    }
    return NextResponse.json({ error: "Could not create marketing link." }, { status: 500 });
  }

  // The deterministic HMAC token is returned but never persisted in plaintext.
  const cacheReady = await prepareMarketingPreviewCache(
    payload.sourceImageUrl,
    payload.sourceHash.toLowerCase(),
    data.expires_at,
    supabase,
    { replyOnly: payload.previewMode === "reply" },
  );
  return linkResponse(token, data.expires_at, false, cacheReady);
}

function linkResponse(
  token: string,
  expiresAt: string,
  reused: boolean,
  previewCacheReady: boolean,
) {
  return NextResponse.json({
    url: `${getAppUrl()}/g/${token}`,
    expiresAt,
    reused,
    previewCacheReady,
  });
}
