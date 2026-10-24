import Link from "next/link";
import { Edit3, Eye, PackageCheck, PackagePlus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  isProductCustomerCopyReady,
  isProductTemplateReady,
} from "@/lib/product-template-status";
import { formatDate, formatMoney } from "@/lib/utils";
import { setProductActive } from "./actions";

export const dynamic = "force-dynamic";

type ProductRow = {
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
  product_variants: Array<{ id: string; active: boolean }>;
};

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin("/admin/products");
  const params = await searchParams;
  const notice = Array.isArray(params.notice) ? params.notice[0] : params.notice;
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const supabase = getSupabaseServiceClient();
  const { data, error } = supabase
    ? await supabase.from("products")
        .select("id,slug,name,category,description,base_price_cents,currency,card_image_url,customization,active,created_at,product_variants(id,active)")
        .order("created_at", { ascending: false })
    : { data: null, error: new Error("Supabase 服务端配置缺失。") };
  const products = (data ?? []) as ProductRow[];

  return (
    <AppShell admin>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-accent">
              <PackageCheck size={18} /> Product management
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-[-0.03em]">商品管理</h1>
            <p className="mt-2 text-sm text-muted">新商品默认下架。检查无误后在这里上架，前台只展示已上架商品。</p>
          </div>
          <Link className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 font-black text-accent-ink hover:bg-accent-strong" href="/admin/product-intake">
            <PackagePlus size={17} /> 新增商品
          </Link>
        </header>

        {notice === "created" ? (
          <p className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
            商品 {slug ? `“${slug}”` : ""} 已新增并保持下架。请在 Codex 中提供该 slug 和 PSD，模板完成后才能上架。
          </p>
        ) : null}
        {error ? (
          <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
            无法读取商品：{error.message}。请确认数据库迁移已经应用。
          </p>
        ) : null}

        <section className="mt-6 grid gap-4">
          {products.map((product) => {
            const activeVariants = product.product_variants.filter((variant) => variant.active).length;
            const templateReady = isProductTemplateReady(product.customization);
            const customerCopyReady = isProductCustomerCopyReady(product.customization);
            return (
              <article className="grid gap-4 rounded-xl border border-line bg-panel p-4 md:grid-cols-[120px_minmax(0,1fr)_auto] md:items-center" key={product.id}>
                <div className="aspect-square overflow-hidden rounded-lg border border-line bg-[#e9e4da]">
                  {product.card_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt={product.name} className="h-full w-full object-contain" src={product.card_image_url} />
                  ) : <div className="grid h-full place-items-center text-xs text-muted">无商品图</div>}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-black">{product.name}</h2>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${product.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                      {product.active ? "已上架" : "已下架"}
                    </span>
                    {!templateReady ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">等待 PSD 模板</span>
                    ) : null}
                    {!customerCopyReady ? (
                      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-900">等待英文文案</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted">{product.slug} · {product.category} · {formatDate(product.created_at)}</p>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">
                    {product.description ?? "模板 Skill 将自动生成网站简介。"}
                  </p>
                  <p className="mt-2 text-sm font-bold">{formatMoney(product.base_price_cents, product.currency)} · {activeVariants} 个可售 SKU</p>
                </div>
                <div className="grid min-w-28 gap-2">
                  <Link className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-black hover:bg-surface" href={`/admin/products/${product.id}`}>
                    <Eye size={16} /> 查看
                  </Link>
                  <Link className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-black hover:bg-surface" href={`/admin/products/${product.id}?edit=1`}>
                    <Edit3 size={16} /> 修改
                  </Link>
                  <form action={setProductActive}>
                    <input name="productId" type="hidden" value={product.id} />
                    <input name="active" type="hidden" value={product.active ? "false" : "true"} />
                    <button
                      className={`focus-ring h-10 w-full rounded-lg px-3 text-sm font-black ${product.active ? "border border-line bg-white text-foreground hover:bg-surface" : "bg-accent text-accent-ink hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"}`}
                      disabled={!product.active && (!templateReady || !customerCopyReady)}
                      type="submit"
                    >
                      {product.active ? "下架" : "上架"}
                    </button>
                  </form>
                </div>
              </article>
            );
          })}
          {!products.length && !error ? (
            <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center text-sm text-muted">暂无商品。</div>
          ) : null}
        </section>
      </main>
    </AppShell>
  );
}
