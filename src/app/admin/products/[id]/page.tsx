import Link from "next/link";
import { ArrowLeft, Edit3, Eye, ImageIcon, PackageCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { formatDate, formatMoney } from "@/lib/utils";
import { ProductDetailsEditForm, ProductVariantEditForm } from "./product-edit-forms";

export const dynamic = "force-dynamic";

type ProductOptionRow = {
  id: string;
  option_type: string;
  value: string;
  label: string;
  metadata: unknown;
};

type ProductVariantRow = {
  id: string;
  sku: string;
  color: string;
  style: string;
  size: string;
  price_cents: number;
  currency: string;
  active: boolean;
  created_at: string;
};

type ProductDetailRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string | null;
  base_price_cents: number;
  currency: string;
  card_image_url: string | null;
  customization: unknown;
  active: boolean;
  created_at: string;
  product_options: ProductOptionRow[];
  product_variants: ProductVariantRow[];
};

export default async function AdminProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  await requireAdmin(`/admin/products/${id}`);
  const query = await searchParams;
  const edit = (Array.isArray(query.edit) ? query.edit[0] : query.edit) === "1";
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务端配置缺失。");

  const { data, error } = await supabase.from("products")
    .select("id,slug,name,category,description,base_price_cents,currency,card_image_url,customization,active,created_at,product_options(id,option_type,value,label,metadata),product_variants(id,sku,color,style,size,price_cents,currency,active,created_at)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`商品读取失败：${error.message}`);
  if (!data) notFound();
  const product = data as ProductDetailRow;
  const options = new Map(product.product_options.map((option) => [`${option.option_type}:${option.value}`, option]));
  const customization = readCustomization(product.customization);

  return (
    <AppShell admin>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link className="focus-ring inline-flex items-center gap-2 rounded-md text-sm font-bold text-muted hover:text-foreground" href="/admin/products">
              <ArrowLeft size={16} /> 返回商品管理
            </Link>
            <div className="mt-5 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-accent">
              <PackageCheck size={18} /> Product details
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-black tracking-[-0.03em]">{product.name}</h1>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${product.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                {product.active ? "已上架" : "已下架"}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted">{product.slug} · 创建于 {formatDate(product.created_at)}</p>
          </div>
          <Link
            className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-black hover:bg-surface"
            href={edit ? `/admin/products/${product.id}` : `/admin/products/${product.id}?edit=1`}
          >
            {edit ? <Eye size={17} /> : <Edit3 size={17} />}
            {edit ? "查看模式" : "修改商品"}
          </Link>
        </div>

        {edit ? (
          <section className="mt-6 grid gap-5">
            <ProductDetailsEditForm product={{
              id: product.id,
              name: product.name,
              category: product.category,
              description: product.description,
              cardImageUrl: product.card_image_url,
            }} />
            {product.product_variants.map((variant) => {
              const style = options.get(`style:${variant.style}`);
              const size = options.get(`size:${variant.size}`);
              const dimensions = readDimensions(size?.metadata);
              return (
                <ProductVariantEditForm
                  key={variant.id}
                  productId={product.id}
                  variant={{
                    id: variant.id,
                    sku: variant.sku,
                    styleLabel: style?.label ?? variant.style,
                    lengthCm: dimensions.lengthCm,
                    widthCm: dimensions.widthCm,
                    priceDollars: (variant.price_cents / 100).toFixed(2),
                    currency: variant.currency,
                    active: variant.active,
                  }}
                />
              );
            })}
          </section>
        ) : (
          <section className="mt-6 grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
            <article className="rounded-xl border border-line bg-panel p-4">
              <div className="aspect-square overflow-hidden rounded-lg border border-line bg-[#e9e4da]">
                {product.card_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt={product.name} className="h-full w-full object-contain" src={product.card_image_url} />
                ) : (
                  <div className="grid h-full place-items-center gap-2 text-sm text-muted"><ImageIcon /> 无商品头图</div>
                )}
              </div>
              <p className="mt-3 break-all text-xs leading-5 text-muted">{product.card_image_url ?? "未配置商品头图"}</p>
            </article>

            <div className="grid gap-5">
              <article className="rounded-xl border border-line bg-panel p-5">
                <h2 className="text-lg font-black">商品基本信息</h2>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Info label="商品名称" value={product.name} />
                  <Info label="分类" value={product.category} />
                  <Info label="基础售价" value={formatMoney(product.base_price_cents, product.currency)} />
                  <Info label="币种" value={product.currency.toUpperCase()} />
                </dl>
                <div className="mt-4 border-t border-line pt-4">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">网站简介</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{product.description ?? "未填写"}</p>
                </div>
              </article>

              <article className="rounded-xl border border-line bg-panel p-5">
                <h2 className="text-lg font-black">模板与设计器</h2>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Info label="模板状态" value={customization.templateStatus} />
                  <Info label="英文文案状态" value={customization.customerCopyStatus} />
                  <Info label="导出尺寸" value={`${customization.outputWidth} × ${customization.outputHeight} px`} />
                  <Info label="兜底图" value={customization.defaultArtworkUrl} breakAll />
                </dl>
                <div className="mt-4 border-t border-line pt-4">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">预览模板</p>
                  <p className="mt-2 text-sm leading-6">{customization.mockupTemplateIds.join("、") || "未配置"}</p>
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:col-span-2">
              <h2 className="text-xl font-black">可售规格与 SKU</h2>
              {product.product_variants.map((variant) => {
                const style = options.get(`style:${variant.style}`);
                const size = options.get(`size:${variant.size}`);
                return (
                  <article className="rounded-xl border border-line bg-panel p-5" key={variant.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="break-all text-sm font-black">{variant.sku}</p>
                        <p className="mt-2 text-sm text-muted">{style?.label ?? variant.style} · {size?.label ?? variant.size}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${variant.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                        {variant.active ? "可售" : "停用"}
                      </span>
                    </div>
                    <p className="mt-3 text-lg font-black">{formatMoney(variant.price_cents, variant.currency)}</p>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </AppShell>
  );
}

function Info({ label, value, breakAll = false }: { label: string; value: string; breakAll?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className={`mt-1 text-sm font-semibold ${breakAll ? "break-all" : ""}`}>{value}</dd>
    </div>
  );
}

function readDimensions(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    lengthCm: readPositiveNumber(record.lengthCm),
    widthCm: readPositiveNumber(record.widthCm),
  };
}

function readPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0.01;
}

function readCustomization(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    templateStatus: typeof record.templateStatus === "string" ? record.templateStatus : "pending",
    customerCopyStatus: typeof record.customerCopyStatus === "string" ? record.customerCopyStatus : "pending",
    outputWidth: typeof record.outputWidth === "number" ? record.outputWidth : 0,
    outputHeight: typeof record.outputHeight === "number" ? record.outputHeight : 0,
    defaultArtworkUrl: typeof record.defaultArtworkUrl === "string" ? record.defaultArtworkUrl : "未配置",
    mockupTemplateIds: Array.isArray(record.mockupTemplateIds)
      ? record.mockupTemplateIds.filter((item): item is string => typeof item === "string")
      : [],
  };
}
