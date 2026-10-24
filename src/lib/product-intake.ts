import { z } from "zod";
const optionalText = (max: number) =>
  z.string().trim().max(max).transform((value) => value || null);

export const productIntakeFormSchema = z
  .object({
    mode: z.enum(["new_product", "new_variant"]),
    existingProductSlug: optionalText(120),
    productName: optionalText(160),
    category: optionalText(80),
    priceCents: z.coerce.number().int().positive().max(10_000_000),
    currency: z.string().trim().toLowerCase().regex(/^[a-z]{3}$/),
    styleLabel: z.string().trim().min(1).max(120),
    lengthCm: z.coerce.number().positive().max(1_000),
    widthCm: z.coerce.number().positive().max(1_000),
  })
  .superRefine((value, context) => {
    if (value.mode === "new_product") {
      for (const field of ["productName", "category"] as const) {
        if (!value[field]) context.addIssue({ code: "custom", message: "新增商品时必填", path: [field] });
      }
    }
    if (value.mode === "new_variant" && !value.existingProductSlug) {
      context.addIssue({ code: "custom", message: "新增规格时必须填写现有商品 slug", path: ["existingProductSlug"] });
    }
  });

export function parseProductIntakeForm(formData: FormData) {
  return productIntakeFormSchema.safeParse({
    mode: String(formData.get("mode") ?? "new_product"),
    existingProductSlug: String(formData.get("existingProductSlug") ?? ""),
    productName: String(formData.get("productName") ?? ""),
    category: String(formData.get("category") ?? ""),
    priceCents: formData.get("priceCents"),
    currency: String(formData.get("currency") ?? "usd"),
    styleLabel: String(formData.get("styleLabel") ?? ""),
    lengthCm: formData.get("lengthCm"),
    widthCm: formData.get("widthCm"),
  });
}

export function slugifyProductValue(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
