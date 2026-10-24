"use client";

import { useActionState, useState } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";
import { buildProductSize } from "@/lib/product-dimensions";
import { createProduct, type ProductIntakeActionState } from "./actions";

const fieldClass =
  "focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-foreground";
const initialProductIntakeActionState: ProductIntakeActionState = { message: "", status: "idle" };
const initialFormValues = {
  mode: "new_product",
  existingProductSlug: "",
  productName: "",
  category: "",
  priceCents: "",
  currency: "usd",
  styleLabel: "",
  lengthCm: "",
  widthCm: "",
};

export function ProductIntakeForm() {
  const [values, setValues] = useState(initialFormValues);
  const [state, formAction] = useActionState(
    createProduct,
    initialProductIntakeActionState,
  );
  const parsedLength = Number(values.lengthCm);
  const parsedWidth = Number(values.widthCm);
  const sizePreview = parsedLength > 0 && parsedWidth > 0
    ? buildProductSize(parsedLength, parsedWidth).label
    : null;
  const updateValue = (field: keyof typeof initialFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  return (
    <form action={formAction} className="space-y-6">
      <Section
        description="填写商品身份和售价。提交后商品保持下架，并等待在 Codex 中处理 PSD 模板。"
        title="1. 商品基础信息"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="添加类型">
            <select className={fieldClass} name="mode" onChange={(event) => updateValue("mode", event.target.value)} value={values.mode}>
              <option value="new_product">全新商品</option>
              <option value="new_variant">现有商品新增规格</option>
            </select>
          </Field>
          <Field hint="仅在新增规格时填写，例如 custom-pillow" label="现有商品 slug">
            <input className={fieldClass} name="existingProductSlug" onChange={(event) => updateValue("existingProductSlug", event.target.value)} value={values.existingProductSlug} />
          </Field>
          <Field hint="可以填中文；处理 PSD 时会生成顾客看到的英文名称" label="商品名称">
            <input className={fieldClass} name="productName" onChange={(event) => updateValue("productName", event.target.value)} placeholder="例如：定制洗脸巾" value={values.productName} />
          </Field>
          <Field hint="可以填中文，例如：毛巾" label="分类">
            <input className={fieldClass} name="category" onChange={(event) => updateValue("category", event.target.value)} placeholder="例如：毛巾" value={values.category} />
          </Field>
          <Field label="网站售价（美分）">
            <input className={fieldClass} min="1" name="priceCents" onChange={(event) => updateValue("priceCents", event.target.value)} required type="number" value={values.priceCents} />
          </Field>
          <Field label="币种">
            <input className={fieldClass} maxLength={3} name="currency" onChange={(event) => updateValue("currency", event.target.value)} required value={values.currency} />
          </Field>
        </div>
        <p className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
          网站简介、商品卡片图、裁剪尺寸和真实预览模板不在这里填写。新增商品后，把商品 slug 和 PSD 发给 Codex，模板 Skill 会自动生成并接入网站。
        </p>
      </Section>

      <Section
        description="输入厘米尺寸后系统会自动换算并保存对应英寸；当前一次提交一个可售组合。"
        title="2. 售卖规格"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field hint="可以填中文；正式上架前会转换成英文展示" label="款式 / 材质">
            <input className={fieldClass} name="styleLabel" onChange={(event) => updateValue("styleLabel", event.target.value)} placeholder="例如：超细纤维" required value={values.styleLabel} />
          </Field>
          <Field label="长度（cm）">
            <input className={fieldClass} min="0.01" name="lengthCm" onChange={(event) => updateValue("lengthCm", event.target.value)} required step="0.01" type="number" value={values.lengthCm} />
          </Field>
          <Field label="宽度（cm）">
            <input className={fieldClass} min="0.01" name="widthCm" onChange={(event) => updateValue("widthCm", event.target.value)} required step="0.01" type="number" value={values.widthCm} />
          </Field>
        </div>
        <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted" aria-live="polite">
          {sizePreview ? `保存后的尺码：${sizePreview}` : "填写长、宽后，这里会显示自动换算的英寸尺码。"}
        </p>
      </Section>

      {state.status === "error" ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-danger" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="flex justify-end">
        <FormSubmitButton
          className="focus-ring inline-flex h-12 items-center justify-center rounded-lg bg-accent px-6 font-black text-accent-ink hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          idleLabel="新增商品"
          pendingLabel="正在新增商品…"
        />
      </div>
    </form>
  );
}

function Section({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h2 className="text-xl font-black">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

function Field({
  children,
  hint,
  label,
}: {
  children: React.ReactNode;
  hint?: string;
  label: string;
}) {
  return (
    <div className="block text-sm font-bold">
      <span className="block">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs font-normal text-muted">{hint}</span> : null}
    </div>
  );
}
