import { z } from "zod";

export const marketingLinkRequestSchema = z.object({
  campaign: z.string().trim().min(1).max(100),
  channel: z.enum(["consent_reply", "public_reply", "direct_message"]),
  variant: z.string().trim().min(1).max(100),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceImageUrl: z.url().max(2048).refine((value) => value.startsWith("https://")).optional(),
  productSlug: z.enum(["custom-pillow", "face-towel"]).optional(),
  previewMode: z.enum(["reply", "full"]).default("full"),
}).refine((value) => Boolean(value.sourceImageUrl) !== Boolean(value.productSlug),
  "Provide exactly one of sourceImageUrl or productSlug");

export function marketingDestinationPath(productSlug: string | null, activeSlugs: ReadonlySet<string>) {
  if (!productSlug) return "/design";
  return activeSlugs.has(productSlug) && ["custom-pillow", "face-towel"].includes(productSlug)
    ? `/design?product=${encodeURIComponent(productSlug)}` : "/products?unavailable=1";
}
