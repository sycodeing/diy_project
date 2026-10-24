"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { buildProductSize } from "@/lib/product-dimensions";
import {
  containsChineseText,
  isProductCustomerCopyReady,
  isProductTemplateReady,
} from "@/lib/product-template-status";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const productIdSchema = z.string().uuid();

export type ProductEditActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const productDetailsSchema = z.object({
  name: z.string().trim().min(1, "请填写商品名称。").max(160),
  category: z.string().trim().min(1, "请填写分类。").max(80),
  description: z.string().trim().min(1, "请填写网站简介。").max(2_000),
  cardImageUrl: z.string().trim().min(1, "请填写商品头图路径。").max(500).refine(
    (value) => isSafeImageUrl(value),
    "商品头图必须是站内绝对路径或 HTTPS 地址。",
  ),
});

const productVariantSchema = z.object({
  styleLabel: z.string().trim().min(1, "请填写款式或材质。").max(120),
  lengthCm: z.coerce.number().positive("长度必须大于 0。").max(1_000),
  widthCm: z.coerce.number().positive("宽度必须大于 0。").max(1_000),
  priceDollars: z.coerce.number().positive("售价必须大于 0。").max(100_000),
  currency: z.string().trim().toLowerCase().regex(/^[a-z]{3}$/, "币种必须是 3 位英文代码。"),
  active: z.boolean(),
});

export async function setProductActive(formData: FormData) {
  await requireAdmin("/admin/products");
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端配置缺失。");

  const productId = productIdSchema.parse(String(formData.get("productId") ?? ""));
  const active = String(formData.get("active") ?? "") === "true";

  if (active) {
    const [
      { data: product, error: productError },
      { count, error: variantError },
      { data: options, error: optionError },
    ] = await Promise.all([
      supabase.from("products").select("name,category,description,card_image_url,customization").eq("id", productId).maybeSingle(),
      supabase.from("product_variants").select("id", { count: "exact", head: true }).eq("product_id", productId).eq("active", true),
      supabase.from("product_options").select("label").eq("product_id", productId),
    ]);
    if (productError || variantError || optionError) {
      throw new Error(productError?.message ?? variantError?.message ?? optionError?.message);
    }
    const hasChineseStorefrontCopy = containsChineseText(product?.name) ||
      containsChineseText(product?.category) ||
      containsChineseText(product?.description) ||
      (options ?? []).some((option) => containsChineseText(option.label));
    if (
      !product?.description ||
      !product.card_image_url ||
      !isProductTemplateReady(product.customization) ||
      !isProductCustomerCopyReady(product.customization) ||
      hasChineseStorefrontCopy ||
      !count
    ) {
      throw new Error("PSD 模板、英文网站文案、商品图或可售 SKU 尚未准备完成，暂时不能上架。");
    }
  }

  const { error } = await supabase.from("products").update({ active }).eq("id", productId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/products");
  revalidatePath("/products");
  revalidatePath("/design");
}

export async function updateProductDetails(
  productId: string,
  _previousState: ProductEditActionState,
  formData: FormData,
): Promise<ProductEditActionState> {
  await requireAdmin(`/admin/products/${productId}`);
  const supabase = getSupabaseServiceClient();
  if (!supabase) return editError("Supabase 服务端配置缺失，无法保存商品。");

  const parsedId = productIdSchema.safeParse(productId);
  if (!parsedId.success) return editError("商品 ID 无效。");
  const parsed = productDetailsSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    description: formData.get("description"),
    cardImageUrl: formData.get("cardImageUrl"),
  });
  if (!parsed.success) return editError(parsed.error.issues[0]?.message ?? "请检查商品信息。");

  const { data: current, error: readError } = await supabase
    .from("products")
    .select("active")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (readError) return editError(`商品读取失败：${readError.message}`);
  if (!current) return editError("商品不存在或已被删除。");

  if (current.active && [parsed.data.name, parsed.data.category, parsed.data.description].some(containsChineseText)) {
    return editError("已上架商品的顾客可见名称、分类和简介必须使用英文。请先下架再保存中文草稿。");
  }

  const { error } = await supabase.from("products").update({
    name: parsed.data.name,
    category: parsed.data.category,
    description: parsed.data.description,
    card_image_url: parsed.data.cardImageUrl,
  }).eq("id", parsedId.data);
  if (error) return editError(`商品保存失败：${error.message}`);

  revalidateProductPages(parsedId.data);
  return { status: "success", message: "商品基本信息已保存。" };
}

export async function updateProductVariant(
  productId: string,
  variantId: string,
  _previousState: ProductEditActionState,
  formData: FormData,
): Promise<ProductEditActionState> {
  await requireAdmin(`/admin/products/${productId}`);
  const supabase = getSupabaseServiceClient();
  if (!supabase) return editError("Supabase 服务端配置缺失，无法保存规格。");

  const parsedProductId = productIdSchema.safeParse(productId);
  const parsedVariantId = productIdSchema.safeParse(variantId);
  if (!parsedProductId.success || !parsedVariantId.success) return editError("商品或 SKU ID 无效。");
  const parsed = productVariantSchema.safeParse({
    styleLabel: formData.get("styleLabel"),
    lengthCm: formData.get("lengthCm"),
    widthCm: formData.get("widthCm"),
    priceDollars: formData.get("priceDollars"),
    currency: formData.get("currency"),
    active: formData.get("active") === "true",
  });
  if (!parsed.success) return editError(parsed.error.issues[0]?.message ?? "请检查规格信息。");

  const [{ data: product, error: productError }, { data: variant, error: variantError }] = await Promise.all([
    supabase.from("products").select("name,active").eq("id", parsedProductId.data).maybeSingle(),
    supabase.from("product_variants")
      .select("id,style,size,procurement,active")
      .eq("id", parsedVariantId.data)
      .eq("product_id", parsedProductId.data)
      .maybeSingle(),
  ]);
  if (productError || variantError) return editError(`规格读取失败：${productError?.message ?? variantError?.message}`);
  if (!product || !variant) return editError("商品或 SKU 不存在。");
  if (product.active && containsChineseText(parsed.data.styleLabel)) {
    return editError("已上架商品的款式/材质必须使用英文。请先下架再保存中文草稿。");
  }
  if (product.active && variant.active && !parsed.data.active) {
    const { count, error: countError } = await supabase.from("product_variants")
      .select("id", { count: "exact", head: true })
      .eq("product_id", parsedProductId.data)
      .eq("active", true);
    if (countError) return editError(`SKU 状态校验失败：${countError.message}`);
    if ((count ?? 0) <= 1) return editError("已上架商品至少需要保留一个可售 SKU。请先下架商品。");
  }

  const size = buildProductSize(parsed.data.lengthCm, parsed.data.widthCm);
  const priceCents = Math.round(parsed.data.priceDollars * 100);
  const procurement = variant.procurement && typeof variant.procurement === "object" && !Array.isArray(variant.procurement)
    ? variant.procurement as Record<string, unknown>
    : {};
  const { error: optionError } = await supabase.from("product_options").upsert([
    {
      product_id: parsedProductId.data,
      option_type: "style",
      value: variant.style,
      label: parsed.data.styleLabel,
      metadata: {},
      sort_order: 1,
    },
    {
      product_id: parsedProductId.data,
      option_type: "size",
      value: variant.size,
      label: size.label,
      metadata: size.metadata,
      sort_order: 1,
    },
  ], { onConflict: "product_id,option_type,value" });
  if (optionError) return editError(`规格选项保存失败：${optionError.message}`);

  const { error: updateError } = await supabase.from("product_variants").update({
    price_cents: priceCents,
    currency: parsed.data.currency,
    active: parsed.data.active,
    procurement: {
      ...procurement,
      productTitle: product.name,
      selectionInstruction: `${parsed.data.styleLabel}; ${size.label}`,
      currency: parsed.data.currency,
    },
  }).eq("id", parsedVariantId.data).eq("product_id", parsedProductId.data);
  if (updateError) return editError(`SKU 保存失败：${updateError.message}`);

  const { data: activeVariants, error: priceError } = await supabase.from("product_variants")
    .select("price_cents,currency")
    .eq("product_id", parsedProductId.data)
    .eq("active", true)
    .order("price_cents", { ascending: true })
    .limit(1);
  if (priceError) return editError(`商品基础售价同步失败：${priceError.message}`);
  const baseVariant = activeVariants?.[0];
  if (baseVariant) {
    const { error: basePriceError } = await supabase.from("products").update({
      base_price_cents: baseVariant.price_cents,
      currency: baseVariant.currency,
    }).eq("id", parsedProductId.data);
    if (basePriceError) return editError(`商品基础售价同步失败：${basePriceError.message}`);
  }

  revalidateProductPages(parsedProductId.data);
  return { status: "success", message: "SKU 规格与售价已保存。" };
}

function isSafeImageUrl(value: string) {
  if (value.includes("..") || value.includes("\\")) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function editError(message: string): ProductEditActionState {
  return { status: "error", message };
}

function revalidateProductPages(productId: string) {
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/products");
  revalidatePath("/design");
}
