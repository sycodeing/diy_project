import { createHash } from "node:crypto";
import sharp from "sharp";
import templates from "@/lib/mockup-templates.json";
import { getAppUrl } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { ActiveAccountProduct } from "@/lib/x-lead-account-products";

export const ACCOUNT_DESIGN_BUCKET = "account-design-previews";
export const MAX_ACCOUNT_ARTWORK_BYTES = 4 * 1024 * 1024;
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
  const bytes = new Uint8Array(await file.arrayBuffer());
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
  const form = new FormData();
  form.set("template_id", templateId);
  form.set("artwork", new File([png], "account-artwork.png", { type: "image/png" }));
  const response = await fetch(`${getAppUrl()}/api/mockup`, { method: "POST", body: form,
    cache: "no-store", signal: AbortSignal.timeout(90_000) });
  if (!response.ok || !String(response.headers.get("content-type") ?? "").startsWith("image/webp"))
    throw new Error("Product-template preview could not be rendered");
  const preview = new Uint8Array(await response.arrayBuffer());
  if (!preview.length || preview.length > 4 * 1024 * 1024
    || new TextDecoder().decode(preview.slice(0, 4)) !== "RIFF") throw new Error("Rendered preview is invalid");
  const rendered = await sharp(preview, { failOn: "error", limitInputPixels: 16_000_000 }).metadata().catch(() => null);
  if (rendered?.format !== "webp" || !rendered.width || !rendered.height
    || rendered.width < 500 || rendered.height < 500) throw new Error("Rendered preview is not a valid WebP image");
  const previewHash = sha(preview);
  const previewPath = `preview/${artworkHash}/${templateId}-${previewHash}.webp`;
  const asset = { artworkPath, artworkHash, previewPath, previewHash, templateId };
  if (!validAccountDesignAsset(asset, product.slug)) throw new Error("Preview asset identity is invalid");
  await ensureStored(artworkPath, png, "image/png");
  await ensureStored(previewPath, preview, "image/webp");
  return asset;
}

export async function signAccountDesignAsset(path: string, expiresIn = 60 * 60) {
  const supabase = getSupabaseServiceClient();
  if (!supabase || !PATH.test(path) || path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  const { data, error } = await supabase.storage.from(ACCOUNT_DESIGN_BUCKET).createSignedUrl(path, expiresIn);
  return error ? null : data?.signedUrl ?? null;
}
