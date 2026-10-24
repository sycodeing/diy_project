"use client";

import { useActionState } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";
import {
  type ProductEditActionState,
  updateProductDetails,
  updateProductVariant,
} from "../actions";

const INITIAL_STATE: ProductEditActionState = { status: "idle", message: "" };
const inputClass = "focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
const labelClass = "text-sm font-bold";

export function ProductDetailsEditForm({
  product,
}: {
  product: {
    id: string;
    name: string;
    category: string;
    description: string | null;
    cardImageUrl: string | null;
  };
}) {
  const action = updateProductDetails.bind(null, product.id);
  const [state, formAction] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="rounded-xl border border-line bg-panel p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          商品名称
          <input className={inputClass} defaultValue={product.name} maxLength={160} name="name" required />
        </label>
        <label className={labelClass}>
          分类
          <input className={inputClass} defaultValue={product.category} maxLength={80} name="category" required />
        </label>
      </div>

      <label className={`${labelClass} mt-4 block`}>
        网站简介
        <textarea
          className="focus-ring mt-2 min-h-32 w-full rounded-lg border border-line bg-white p-3 text-sm leading-6"
          defaultValue={product.description ?? ""}
          maxLength={2_000}
          name="description"
          required
        />
      </label>

      <label className={`${labelClass} mt-4 block`}>
        商品头图路径
        <input
          className={inputClass}
          defaultValue={product.cardImageUrl ?? ""}
          maxLength={500}
          name="cardImageUrl"
          placeholder="/design-samples/product.webp"
          required
        />
        <span className="mt-2 block text-xs font-normal text-muted">支持站内绝对路径或 HTTPS 地址。</span>
      </label>

      <ActionNotice state={state} />
      <div className="mt-5 flex justify-end">
        <FormSubmitButton
          className="focus-ring h-11 rounded-lg bg-accent px-5 text-sm font-black text-accent-ink hover:bg-accent-strong disabled:opacity-60"
          idleLabel="保存基本信息"
          pendingLabel="保存中…"
        />
      </div>
    </form>
  );
}

export function ProductVariantEditForm({
  productId,
  variant,
}: {
  productId: string;
  variant: {
    id: string;
    sku: string;
    styleLabel: string;
    lengthCm: number;
    widthCm: number;
    priceDollars: string;
    currency: string;
    active: boolean;
  };
}) {
  const action = updateProductVariant.bind(null, productId, variant.id);
  const [state, formAction] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="rounded-xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-black">SKU 规格</h3>
          <p className="mt-1 break-all text-xs text-muted">{variant.sku}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${variant.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
          {variant.active ? "可售" : "停用"}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className={labelClass}>
          款式 / 材质
          <input className={inputClass} defaultValue={variant.styleLabel} maxLength={120} name="styleLabel" required />
        </label>
        <label className={labelClass}>
          长度（cm）
          <input className={inputClass} defaultValue={variant.lengthCm} max="1000" min="0.01" name="lengthCm" required step="0.01" type="number" />
        </label>
        <label className={labelClass}>
          宽度（cm）
          <input className={inputClass} defaultValue={variant.widthCm} max="1000" min="0.01" name="widthCm" required step="0.01" type="number" />
        </label>
        <label className={labelClass}>
          网站售价（美元）
          <input className={inputClass} defaultValue={variant.priceDollars} max="100000" min="0.01" name="priceDollars" required step="0.01" type="number" />
        </label>
        <label className={labelClass}>
          币种
          <input className={inputClass} defaultValue={variant.currency.toUpperCase()} maxLength={3} name="currency" required />
        </label>
        <label className="flex min-h-11 items-center gap-3 self-end rounded-lg border border-line bg-surface px-3 text-sm font-bold">
          <input defaultChecked={variant.active} name="active" type="checkbox" value="true" />
          此 SKU 可售
        </label>
      </div>

      <p className="mt-3 text-xs leading-5 text-muted">保存后会自动换算英寸尺码，并同步商品基础售价。商品上架时至少需要保留一个可售 SKU。</p>
      <ActionNotice state={state} />
      <div className="mt-5 flex justify-end">
        <FormSubmitButton
          className="focus-ring h-11 rounded-lg bg-accent px-5 text-sm font-black text-accent-ink hover:bg-accent-strong disabled:opacity-60"
          idleLabel="保存 SKU"
          pendingLabel="保存中…"
        />
      </div>
    </form>
  );
}

function ActionNotice({ state }: { state: ProductEditActionState }) {
  if (state.status === "idle") return null;
  return (
    <p className={`mt-4 rounded-lg border p-3 text-sm font-semibold ${state.status === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
      {state.message}
    </p>
  );
}
