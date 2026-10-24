import { PackagePlus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { ProductIntakeForm } from "./product-intake-form";

export const dynamic = "force-dynamic";

export default async function ProductIntakePage() {
  await requireAdmin("/admin/product-intake");

  return (
    <AppShell admin>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <header>
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-accent">
            <PackagePlus size={18} /> Product intake
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.03em]">商品上新</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            提交后会直接新增到网站商品库并保持下架。之后在 Codex 中提供商品 slug 和 PSD，模板 Skill 会生成预览、卡片图和网站简介并接入商品。
          </p>
        </header>

        <div className="mt-6">
          <ProductIntakeForm />
        </div>
      </main>
    </AppShell>
  );
}
