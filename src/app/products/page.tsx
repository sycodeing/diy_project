import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Clock3 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PRODUCT_CATALOG } from "@/lib/product-catalog";
import { formatMoney } from "@/lib/utils";

export default function ProductsPage() {
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <header className="max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-accent">Product collection</p>
          <h1 className="mt-3 text-4xl font-black tracking-[-0.035em] sm:text-5xl">Choose what to customize</h1>
          <p className="mt-4 text-base leading-7 text-muted">Start with a product, then add your image and preview the result before ordering.</p>
        </header>

        <section aria-label="Available products" className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCT_CATALOG.map((product) => (
            <article className="overflow-hidden rounded-2xl border border-line bg-panel shadow-sm" key={product.slug}>
              <div className="relative aspect-[4/3] bg-surface">
                <Image alt={product.name} className="object-cover" fill sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" src={product.image} />
                <span className="absolute left-4 top-4 rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-accent-strong shadow-sm">Available now</span>
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-xl font-black">{product.name}</h2>
                  <p className="shrink-0 font-black">{formatMoney(product.priceCents, "usd")}</p>
                </div>
                <p className="mt-2 min-h-12 text-sm leading-6 text-muted">{product.description}</p>
                <Link className="focus-ring mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 font-bold text-accent-ink hover:bg-accent-strong" href={product.href}>
                  Customize this product <ArrowRight size={17} />
                </Link>
              </div>
            </article>
          ))}

          <article className="flex min-h-[330px] flex-col justify-center rounded-2xl border border-dashed border-line bg-surface/70 p-6 text-center sm:items-center">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-panel text-muted"><Clock3 size={22} /></span>
            <h2 className="mt-4 text-xl font-black">More products coming soon</h2>
            <p className="mt-2 max-w-xs text-sm leading-6 text-muted">We’ll add new customizable products here as they become available.</p>
          </article>
        </section>
      </main>
    </AppShell>
  );
}
