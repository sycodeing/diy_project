import { MARKETING_PREVIEW_BUCKET } from "@/lib/marketing";
import { getAppUrl } from "@/lib/env";
import { fetchRemoteImage } from "@/lib/remote-image";
import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_ARTWORK_BYTES = 10 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 12 * 1024 * 1024;
const PREVIEW_TEMPLATES = [
  { id: "pillow-psd-03-grey-sofa", label: "Grey sofa close-up" },
  { id: "pillow-psd-04-size", label: "18in / 45cm size" },
  { id: "pillow-psd-06-wood-chair", label: "Wood chair" },
  { id: "pillow-psd-01", label: "Sofa room" },
] as const;

export async function prepareMarketingPreviewCache(
  sourceImageUrl: string,
  sourceHash: string,
  expiresAt: string,
  supabase: SupabaseClient,
  options: { replyOnly?: boolean } = {},
) {
  const templates = options.replyOnly ? PREVIEW_TEMPLATES.slice(0, 1) : PREVIEW_TEMPLATES;
  const { data: cachedObjects, error: cacheListError } = await supabase.storage
    .from(MARKETING_PREVIEW_BUCKET)
    .list(sourceHash.toLowerCase(), { limit: PREVIEW_TEMPLATES.length + 1 });
  const cachedNames = new Set((cachedObjects ?? []).map((item) => item.name));
  const ready = !cacheListError && templates.every((template) => cachedNames.has(`${template.id}.webp`));
  if (ready) return true;

  const rendererBase = process.env.NEXT_PUBLIC_MOCKUP_RENDERER_URL?.replace(/\/$/, "");
  const rendererUrl = rendererBase ? `${rendererBase}/render-preview` : `${getAppUrl()}/api/mockup`;

  try {
    const artworkResponse = await fetchRemoteImage(sourceImageUrl);
    const contentType = artworkResponse.headers.get("content-type") ?? "";
    if (!artworkResponse.ok || !contentType.startsWith("image/")) return false;

    const artworkBlob = await artworkResponse.blob();
    if (!artworkBlob.size || artworkBlob.size > MAX_ARTWORK_BYTES) return false;

    const { data: bucket } = await supabase.storage.getBucket(MARKETING_PREVIEW_BUCKET);
    if (!bucket) {
      const { error } = await supabase.storage.createBucket(MARKETING_PREVIEW_BUCKET, {
        public: false,
        fileSizeLimit: MAX_PREVIEW_BYTES,
        allowedMimeTypes: ["image/webp", "image/png", "image/jpeg"],
      });
      if (error && !/already exists|duplicate/i.test(error.message)) return false;
    }

    const rendered = await Promise.all(
      templates.map(async (template) => {
        const formData = new FormData();
        formData.append("template_id", template.id);
        formData.append("focus_mode", "pet_head");
        formData.append("artwork", artworkBlob, "artwork.webp");
        const response = await fetch(rendererUrl, {
          body: formData,
          method: "POST",
          signal: AbortSignal.timeout(45_000),
        });
        const resultType = response.headers.get("content-type") ?? "";
        const declaredSize = Number(response.headers.get("content-length") ?? 0);
        if (
          !response.ok ||
          !resultType.startsWith("image/") ||
          declaredSize > MAX_PREVIEW_BYTES
        ) {
          throw new Error(`Preview rendering failed for ${template.id}.`);
        }

        const blob = await response.blob();
        if (!blob.size || blob.size > MAX_PREVIEW_BYTES) {
          throw new Error(`Preview image is invalid for ${template.id}.`);
        }

        const path = `${sourceHash.toLowerCase()}/${template.id}.webp`;
        const { error } = await supabase.storage
          .from(MARKETING_PREVIEW_BUCKET)
          .upload(path, blob, {
            cacheControl: "604800",
            contentType: resultType,
            upsert: true,
          });
        if (error) throw error;
        return template.id;
      }),
    );

    return rendered.length === templates.length;
  } catch {
    return false;
  }
}
