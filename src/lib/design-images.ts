import type { SupabaseClient } from "@supabase/supabase-js";
import type { DesignPayload, ProductSide } from "@/lib/types";

export async function createDesignImageUrls(
  supabase: SupabaseClient,
  design: DesignPayload,
) {
  const urls: Partial<Record<ProductSide, string>> = {};

  for (const side of ["front", "back"] as const) {
    const imagePath = design.sides[side].imagePath;

    if (!imagePath) {
      continue;
    }

    const { data } = await supabase.storage
      .from("design-assets")
      .createSignedUrl(imagePath, 60 * 60);

    if (data?.signedUrl) {
      urls[side] = data.signedUrl;
    }
  }

  return urls;
}

