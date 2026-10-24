import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DiyDesigner } from "@/components/diy-designer";
import { getPayPalConfig, getSupabaseBrowserConfig } from "@/lib/env";
import { getMarketingPreviewUrls, getActiveMarketingLinkFromCookie } from "@/lib/marketing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_PRODUCT_CONFIG, type DesignerProductConfig } from "@/lib/product-config";
import type { DesignPayload, ShippingAddress } from "@/lib/types";

const ALLOWED_PARAMS = new Set([
  "image",
  "imageUrl",
  "img",
  "shape",
  "position",
  "checkout",
  "product",
  "internal_test",
]);

export default async function DesignPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const paramEntries = Object.entries(params);
  const allowedEntries = paramEntries.filter(([key]) => ALLOWED_PARAMS.has(key));

  if (allowedEntries.length !== paramEntries.length) {
    const cleanParams = new URLSearchParams();

    for (const [key, value] of allowedEntries) {
      const firstValue = Array.isArray(value) ? value[0] : value;
      if (firstValue) cleanParams.set(key, firstValue);
    }

    const queryString = cleanParams.toString();
    redirect(queryString ? `/design?${queryString}` : "/design");
  }

  const initialParams = Object.fromEntries(
    allowedEntries.map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const supabase = await createSupabaseServerClient();
  const productConfig = await getProductConfig(supabase, initialParams.product);
  if (!productConfig) notFound();
  const { data: { user } } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };
  const { data: latestOrder } = supabase && user
    ? await supabase
        .from("orders")
        .select("shipping")
        .eq("user_id", user.id)
        .not("shipping", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const defaultShippingAddress = toShippingAddress(latestOrder?.shipping);
  const marketingLink = await getActiveMarketingLinkFromCookie();
  const linkedImage = initialParams.image ?? initialParams.imageUrl ?? initialParams.img;
  const cachedMockupPreviews = marketingLink && linkedImage === marketingLink.source_image_url
    ? await getMarketingPreviewUrls(marketingLink.source_hash, marketingLink.expires_at)
    : [];

  return (
    <AppShell>
      <DiyDesigner
        authEnabled={Boolean(getSupabaseBrowserConfig())}
        paypalEnabled={Boolean(getPayPalConfig().clientId && getPayPalConfig().clientSecret)}
        autoCheckout={initialParams.checkout === "1"}
        cachedMockupPreviews={cachedMockupPreviews}
        cachedMockupSourceImageUrl={cachedMockupPreviews.length ? linkedImage : null}
        initialParams={initialParams}
        isAuthenticated={Boolean(user)}
        userId={user?.id ?? null}
        defaultShippingAddress={defaultShippingAddress}
        productConfig={productConfig}
      />
    </AppShell>
  );
}

async function getProductConfig(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  requestedSlug?: string,
): Promise<DesignerProductConfig | null> {
  const slug = requestedSlug ?? DEFAULT_PRODUCT_CONFIG.slug;
  if (!supabase) return slug === DEFAULT_PRODUCT_CONFIG.slug ? DEFAULT_PRODUCT_CONFIG : null;

  const { data: product } = await supabase.from("products")
    .select("id,slug,name,description,base_price_cents,currency,customization")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  if (!product) return slug === DEFAULT_PRODUCT_CONFIG.slug ? DEFAULT_PRODUCT_CONFIG : null;

  const [{ data: variants }, { data: options }] = await Promise.all([
    supabase.from("product_variants")
      .select("color,style,size,price_cents,currency")
      .eq("product_id", product.id)
      .eq("active", true)
      .limit(1),
    supabase.from("product_options")
      .select("option_type,value,label,metadata,sort_order")
      .eq("product_id", product.id)
      .order("sort_order"),
  ]);
  const variant = variants?.[0];
  if (!variant) return null;

  const customization = readCustomization(product.customization);
  const colorOptions = (options ?? []).filter((item) => item.option_type === "color").map((item) => ({
    value: item.value,
    label: item.label,
    hex: readHex(item.metadata),
  }));
  const styleOptions = (options ?? []).filter((item) => item.option_type === "style").map((item) => ({ value: item.value, label: item.label }));
  const sizeOptions = (options ?? []).filter((item) => item.option_type === "size").map((item) => ({ value: item.value, label: item.label }));
  const defaultDesign: DesignPayload = {
    selection: { productSlug: product.slug, color: variant.color, style: variant.style, size: variant.size },
    sides: {
      front: { kind: "image", imagePreviewUrl: customization.defaultArtworkUrl, shape: "rectangle", position: "full_panel" },
      back: { kind: "none", shape: "rectangle", position: "reverse_center" },
    },
  };

  return {
    slug: product.slug,
    name: product.name,
    description: product.description ?? "Personalized product",
    priceCents: variant.price_cents ?? product.base_price_cents,
    currency: variant.currency ?? product.currency,
    artworkFrame: {
      shape: customization.outputWidth === customization.outputHeight ? "square" : "rectangle",
      aspectRatio: customization.outputWidth / customization.outputHeight,
      outputWidth: customization.outputWidth,
      outputHeight: customization.outputHeight,
      label: customization.frameLabel,
    },
    previewMode: customization.previewMode,
    mockupTemplateIds: customization.mockupTemplateIds,
    colorOptions: colorOptions.length ? colorOptions : [{ value: variant.color, label: variant.color, hex: "#f5f2ea" }],
    styleOptions: styleOptions.length ? styleOptions : [{ value: variant.style, label: variant.style }],
    sizeOptions: sizeOptions.length ? sizeOptions : [{ value: variant.size, label: variant.size }],
    defaultDesign,
  };
}

function readCustomization(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    outputWidth: validDimension(record.outputWidth) ?? 1200,
    outputHeight: validDimension(record.outputHeight) ?? 1200,
    frameLabel: typeof record.frameLabel === "string" ? record.frameLabel : "Product artwork",
    previewMode: record.previewMode === "reuse" ? "reuse" as const : "flat" as const,
    defaultArtworkUrl: readDefaultArtworkUrl(record.defaultArtworkUrl),
    mockupTemplateIds: Array.isArray(record.mockupTemplateIds)
      ? record.mockupTemplateIds.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function readDefaultArtworkUrl(value: unknown) {
  if (typeof value !== "string") return "/design-samples/pastel-color-pattern.jpg";
  if (!value.startsWith("/design-samples/") || value.includes("..") || value.includes("\\")) {
    return "/design-samples/pastel-color-pattern.jpg";
  }
  return value;
}

function validDimension(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 300 && value <= 12_000 ? value : null;
}

function readHex(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "#f5f2ea";
  const hex = (value as Record<string, unknown>).hex;
  return typeof hex === "string" && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#f5f2ea";
}

function toShippingAddress(value: unknown): ShippingAddress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const address = value as Record<string, unknown>;
  const required = ["fullName", "line1", "city", "region", "postalCode", "country"];
  if (required.some((key) => typeof address[key] !== "string" || !address[key]?.trim())) {
    return null;
  }
  return {
    fullName: address.fullName as string,
    line1: address.line1 as string,
    line2: typeof address.line2 === "string" ? address.line2 : undefined,
    city: address.city as string,
    region: address.region as string,
    postalCode: address.postalCode as string,
    country: address.country as string,
    phone: typeof address.phone === "string" ? address.phone : undefined,
  };
}
