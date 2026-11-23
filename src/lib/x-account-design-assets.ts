import { createHash } from "node:crypto";
import sharp from "sharp";
import templates from "@/lib/mockup-templates.json";
import fingerprints from "@/lib/account-template-fingerprints.json";
import { getAppUrl } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { ActiveAccountProduct } from "@/lib/x-lead-account-products";
import { resolveAccountDesignCache } from "@/lib/x-account-design-cache";

export const ACCOUNT_DESIGN_BUCKET = "account-design-previews";
export const MAX_ACCOUNT_ARTWORK_BYTES = 4 * 1024 * 1024;
export const ACCOUNT_RENDER_REVISION = "template-render-20261123-v1";
export type AccountDesignAsset = {
  artworkPath: string;
  artworkHash: string;
  previewPath: string;
  previewHash: string;
  templateId: string;
};

const HASH = /^[a-f0-9]{64}$/;
const PATH = /^(?:artwork|preview)\/[A-Za-z0-9._/-]+$/;
const TEMPLATE = new Map(templates.map((item) => [item.id, item.family]));
const inflight = new Map<string, Promise<AccountDesignAsset>>();
export function accountRenderRevision(templateId: string) {
  const fingerprint = (fingerprints as Record<string, string>)[templateId];
  if (!fingerprint || !HASH.test(fingerprint)) throw new Error("Product template fingerprint is missing");
  return `${ACCOUNT_RENDER_REVISION}-${fingerprint.slice(0, 20)}`;
}

export function validAccountDesignAsset(asset: AccountDesignAsset, productSlug: string) {
  const family = productSlug === "custom-pillow" ? "pillow" : productSlug === "face-towel" ? "towel" : null;
  return Boolean(family && HASH.test(asset.artworkHash) && HASH.test(asset.previewHash)
    && PATH.test(asset.artworkPath) && PATH.test(asset.previewPath)
    && !asset.artworkPath.split("/").some((part) => !part || part === "." || part === "..")
    && !asset.previewPath.split("/").some((part) => !part || part === "." || part === "..")
    && asset.artworkPath === `artwork/${asset.artworkHash}.png`
    && asset.previewPath === `preview/${asset.artworkHash}/${asset.templateId}-${asset.previewHash}.webp`
    && TEMPLATE.get(asset.templateId) === family);
}

export function pickAccountTemplate(product: ActiveAccountProduct) {
  const family = product.slug === "custom-pillow" ? "pillow" : "towel";
  return product.mockupTemplateIds?.find((id) => TEMPLATE.get(id) === family) ?? null;
}

function sha(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }

async function ensureStored(path: string, bytes: Uint8Array, mime: "image/png" | "image/webp") {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Asset storage is unavailable");
  const bucket = supabase.storage.from(ACCOUNT_DESIGN_BUCKET);
  const { error } = await bucket.upload(path, bytes, { contentType: mime, upsert: false, cacheControl: "31536000" });
  if (!error) return;
  if (!/already exists|duplicate|409/i.test(error.message)) throw new Error(`Asset upload failed: ${error.message}`);
  const { data: existing, error: downloadError } = await bucket.download(path);
  if (downloadError || !existing || sha(new Uint8Array(await existing.arrayBuffer())) !== sha(bytes))
    throw new Error("Existing asset does not match content hash");
}

/** No prospect photo is used: the upload is brand-owned flat artwork, then the live product renderer composites it. */
export async function createAccountDesignAsset(file: File, product: ActiveAccountProduct): Promise<AccountDesignAsset> {
  if (!file || file.size < 1 || file.size > MAX_ACCOUNT_ARTWORK_BYTES)
    throw new Error("Original PNG/WebP artwork must be at most 4 MB");
  return createAccountDesignAssetFromBytes(new Uint8Array(await file.arrayBuffer()), product);
}

async function validCachedPreview(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 4 * 1024 * 1024 || new TextDecoder().decode(bytes.slice(0, 4)) !== "RIFF") return false;
  const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 16_000_000 }).metadata().catch(() => null);
  return metadata?.format === "webp" && Boolean(metadata.width && metadata.height && metadata.width >= 500 && metadata.height >= 500);
}

async function cachedPreview(artworkHash: string, templateId: string, revision: string) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Asset storage is unavailable");
  const bucket = supabase.storage.from(ACCOUNT_DESIGN_BUCKET);
  const prefix = `cache/${artworkHash}/${templateId}`;
  const { data, error } = await bucket.list(prefix, { limit: 20, search: `${revision}-` });
  if (error) throw new Error(`Design cache lookup failed: ${error.message}`);
  for (const item of data ?? []) {
    const match = new RegExp(`^${revision}-([a-f0-9]{64})\\.webp$`).exec(item.name);
    if (!match) continue;
    const { data: file } = await bucket.download(`${prefix}/${item.name}`);
    if (!file) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (sha(bytes) !== match[1] || !await validCachedPreview(bytes)) continue;
    return { bytes, hash: match[1] };
  }
  return null;
}

export async function createAccountDesignAssetFromBytes(bytes: Uint8Array, product: ActiveAccountProduct): Promise<AccountDesignAsset> {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("Original artwork exceeds storage limit");
  const meta = await sharp(bytes, { failOn: "error", limitInputPixels: 16_000_000 }).metadata().catch(() => null);
  if (!meta || !["png", "webp"].includes(meta.format ?? "") || !meta.width || !meta.height
    || meta.width < 600 || meta.height < 600 || meta.width > 4096 || meta.height > 4096
    || Math.abs(meta.width / meta.height - 1) > 0.1)
    throw new Error("Artwork must be a valid, near-square PNG/WebP of 600–4096 pixels");
  if (!((meta.format === "png" && bytes[0] === 0x89 && bytes[1] === 0x50)
    || (meta.format === "webp" && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF")))
    throw new Error("Artwork bytes do not match their image format");
  const templateId = pickAccountTemplate(product);
  if (!templateId) throw new Error("Selected product has no valid preview template");
  const png = meta.format === "png" ? bytes : new Uint8Array(await sharp(bytes).png().toBuffer());
  if (png.length > 10 * 1024 * 1024) throw new Error("Normalized artwork exceeds storage limit");
  const artworkHash = sha(png);
  const artworkPath = `artwork/${artworkHash}.png`;
  const revision = accountRenderRevision(templateId);
  const key = `${artworkHash}:${templateId}:${revision}`;
  return resolveAccountDesignCache(inflight, key,
    async () => {
      const cached = await cachedPreview(artworkHash, templateId, revision);
      if (!cached) return null;
      const previewPath = `preview/${artworkHash}/${templateId}-${cached.hash}.webp`;
      const asset = { artworkPath, artworkHash, previewPath, previewHash: cached.hash, templateId };
      if (!validAccountDesignAsset(asset, product.slug)) throw new Error("Cached design identity is invalid");
      await ensureStored(artworkPath, png, "image/png");
      await ensureStored(previewPath, cached.bytes, "image/webp");
      return asset;
    },
    () => materializeAccountDesignAsset(png, artworkHash, artworkPath, templateId, revision, product));
}

async function materializeAccountDesignAsset(png: Uint8Array, artworkHash: string, artworkPath: string,
  templateId: string, revision: string, product: ActiveAccountProduct): Promise<AccountDesignAsset> {
  const form = new FormData();
  form.set("template_id", templateId);
  const upload = new Uint8Array(png.byteLength);
  upload.set(png);
  form.set("artwork", new File([upload], "account-artwork.png", { type: "image/png" }));
  const response = await fetch(`${getAppUrl()}/api/mockup`, { method: "POST", body: form,
    cache: "no-store", signal: AbortSignal.timeout(90_000) });
  if (!response.ok || !String(response.headers.get("content-type") ?? "").startsWith("image/webp"))
    throw new Error("Product-template preview could not be rendered");
  const preview = new Uint8Array(await response.arrayBuffer());
  if (!await validCachedPreview(preview)) throw new Error("Rendered preview is invalid");
  const previewHash = sha(preview);
  const previewPath = `preview/${artworkHash}/${templateId}-${previewHash}.webp`;
  const asset = { artworkPath, artworkHash, previewPath, previewHash, templateId };
  if (!validAccountDesignAsset(asset, product.slug)) throw new Error("Preview asset identity is invalid");
  await ensureStored(artworkPath, png, "image/png");
  await ensureStored(previewPath, preview, "image/webp");
  await ensureStored(`cache/${artworkHash}/${templateId}/${revision}-${previewHash}.webp`, preview, "image/webp");
  return asset;
}

export async function signAccountDesignAsset(path: string, expiresIn = 60 * 60) {
  const supabase = getSupabaseServiceClient();
  if (!supabase || !PATH.test(path) || path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  const { data, error } = await supabase.storage.from(ACCOUNT_DESIGN_BUCKET).createSignedUrl(path, expiresIn);
  return error ? null : data?.signedUrl ?? null;
}
