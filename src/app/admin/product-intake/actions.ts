"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import {
  parseProductIntakeForm,
  slugifyProductValue,
} from "@/lib/product-intake";
import { buildProductSize } from "@/lib/product-dimensions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type ProductIntakeActionState = { message: string; status: "idle" | "error" };

export async function createProduct(
  _previousState: ProductIntakeActionState,
  formData: FormData,
): Promise<ProductIntakeActionState> {
  await requireAdmin("/admin/product-intake");
  const supabase = getSupabaseServiceClient();
  if (!supabase) return { status: "error", message: "Supabase 服务端配置缺失，无法新增商品。" };

  const parsed = parseProductIntakeForm(formData);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "请检查表单内容。" };
  const values = parsed.data;

  const slug = values.mode === "new_product"
    ? slugifyProductValue(values.productName ?? "") || `product-${randomUUID().slice(0, 8)}`
    : values.existingProductSlug ?? "";
  if (!slug) return { status: "error", message: "请填写现有商品 slug。" };

  const { data: existingProduct, error: existingError } = await supabase
    .from("products").select("id,name").eq("slug", slug).maybeSingle();
  if (existingError) return { status: "error", message: `商品校验失败：${existingError.message}` };
  if (values.mode === "new_product" && existingProduct) return { status: "error", message: `slug “${slug}” 已存在，请修改商品英文名。` };
  if (values.mode === "new_variant" && !existingProduct) return { status: "error", message: `没有找到商品 “${slug}”。` };

  let productId = existingProduct?.id ?? null;
  if (values.mode === "new_product") {
    const { data: product, error } = await supabase.from("products").insert({
      slug,
      name: values.productName,
      category: values.category,
      description: null,
      base_price_cents: values.priceCents,
      currency: values.currency,
      card_image_url: null,
      customization: {
        templateStatus: "pending",
        customerCopyStatus: "pending",
      },
      active: false,
    }).select("id").single();
    if (error || !product) {
      return { status: "error", message: `商品新增失败：${error?.message ?? "未知错误"}` };
    }
    productId = product.id;
  }

  let color = "standard";
  if (values.mode === "new_variant") {
    const { data: existingVariant } = await supabase
      .from("product_variants")
      .select("color")
      .eq("product_id", productId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    color = existingVariant?.color || color;
  }

  const size = buildProductSize(values.lengthCm, values.widthCm);
  const style = slugifyProductValue(values.styleLabel) || `style-${randomUUID().slice(0, 8)}`;
  const sizeValue = slugifyProductValue(size.label);
  if (!productId || !sizeValue) {
    await rollbackNewProduct(supabase, values.mode, productId);
    return { status: "error", message: "商品或尺寸信息无效，请检查后重试。" };
  }

  const sku = `${slug}-${style}-${sizeValue}-${randomUUID().slice(0, 8)}`.toUpperCase().slice(0, 180);
  const { data: variant, error: variantError } = await supabase.from("product_variants").insert({
    product_id: productId,
    sku,
    color,
    style,
    size: sizeValue,
    price_cents: values.priceCents,
    currency: values.currency,
    active: true,
    procurement: {
      provider: "manual",
      productTitle: values.productName ?? existingProduct?.name ?? slug,
      goodsId: null,
      skuId: null,
      selectionInstruction: `${values.styleLabel}; ${size.label}`,
      quantity: 1,
      expectedAmountCents: null,
      currency: values.currency,
    },
  }).select("id").single();
  if (variantError || !variant) {
    await rollbackNewProduct(supabase, values.mode, productId);
    return { status: "error", message: `商品 SKU 新增失败：${variantError?.message ?? "未知错误"}` };
  }

  const { error: optionError } = await supabase.from("product_options").upsert([
    { product_id: productId, option_type: "style", value: style, label: values.styleLabel, metadata: {}, sort_order: 1 },
    { product_id: productId, option_type: "size", value: sizeValue, label: size.label, metadata: size.metadata, sort_order: 1 },
  ], { onConflict: "product_id,option_type,value" });
  if (optionError) {
    if (values.mode === "new_variant") await supabase.from("product_variants").delete().eq("id", variant.id);
    await rollbackNewProduct(supabase, values.mode, productId);
    return { status: "error", message: `商品规格新增失败：${optionError.message}` };
  }

  revalidatePath("/admin/products");
  revalidatePath("/products");
  redirect(`/admin/products?notice=created&slug=${encodeURIComponent(slug)}`);
}

async function rollbackNewProduct(
  supabase: NonNullable<ReturnType<typeof getSupabaseServiceClient>>,
  mode: "new_product" | "new_variant",
  productId: string | null,
) {
  if (mode === "new_product" && productId) await supabase.from("products").delete().eq("id", productId);
}
