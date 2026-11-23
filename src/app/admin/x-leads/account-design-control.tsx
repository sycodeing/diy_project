"use client";

import { useActionState, useState } from "react";
import { attachAccountPreview } from "./account-draft-actions";

const MAX_ARTWORK_BYTES = 4 * 1024 * 1024;
const INITIAL_STATE = { ok: false, message: "" };

type Props = {
  authorId: string;
  previewImageUrl?: string | null;
  previewStatus?: string | null;
  previewBrief?: string | null;
  disabledReason?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  text_only: "当前为纯文字草稿",
  ready: "商品模板预览已生成",
  failed: "预览生成失败",
};

function describeBrief(value: string) {
  try {
    const brief = JSON.parse(value) as { visibleMotifs?: unknown; designReason?: unknown };
    if (typeof brief.visibleMotifs === "string" && typeof brief.designReason === "string")
      return `${brief.visibleMotifs} · ${brief.designReason}`;
  } catch { /* Existing drafts may carry plain text. */ }
  return value;
}

export function AccountDesignControl({ authorId, previewImageUrl, previewStatus, previewBrief, disabledReason }: Props) {
  const [state, action, pending] = useActionState(attachAccountPreview, INITIAL_STATE);
  const [fileError, setFileError] = useState("");
  const id = `account-design-${authorId}`;
  const disabled = pending || Boolean(disabledReason);

  return <form action={action} className="mt-3 rounded-lg border border-line bg-panel p-3 text-sm">
    <h3 className="font-bold">为此账号制作原创商品预览</h3>
    <p className="mt-1 text-xs text-muted">本店原创示例，原帖图片未作印花。上传平面图后使用当前商品的真实模板渲染；保存后仍需单独加入 V2 待审并人工批准。</p>
    {previewStatus ? <p className="mt-2 text-xs">预览状态：{STATUS_LABEL[previewStatus] ?? previewStatus}</p> : null}
    {previewBrief ? <p className="mt-1 break-words text-xs text-muted">已保存的设计说明：{describeBrief(previewBrief)}</p> : null}
    {previewImageUrl ? <div className="mt-2">
      {/* Signed storage URLs are short-lived and are intentionally rendered directly for admin review. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={previewImageUrl} alt="已保存的商品模板预览" className="max-h-52 max-w-full rounded border border-line object-contain" />
      <a className="mt-1 inline-block text-xs text-accent underline" href={previewImageUrl} target="_blank" rel="noreferrer">打开预览图</a>
    </div> : null}
    {disabledReason ? <p className="mt-2 text-xs text-amber-800">当前不能更换预览：{disabledReason}</p> : null}
    <input type="hidden" name="authorId" value={authorId} />
    <input type="hidden" name="designSource" value="brand_created" />

    <label className="mt-3 block font-bold" htmlFor={`${id}-artwork`}>本店原创平面设计图</label>
    <input id={`${id}-artwork`} name="artwork" type="file" accept="image/png,image/webp,.png,.webp" required
      disabled={disabled} onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        setFileError(file && file.size > MAX_ARTWORK_BYTES ? "文件超过 4 MB，请换一张更小的原创图。" : "");
      }} className="mt-1 block w-full rounded border border-line bg-surface p-2 text-xs" />
    <p className="mt-1 text-xs text-muted">PNG 或 WebP，≤4 MB；近正方形，宽高各 600–4096 像素。</p>
    {fileError ? <p role="alert" className="mt-1 text-xs text-red-700">{fileError}</p> : null}

    <label className="mt-3 block font-bold" htmlFor={`${id}-motifs`}>图中实际可见的图形</label>
    <input id={`${id}-motifs`} name="visibleMotifs" type="text" required minLength={5} maxLength={90}
      disabled={disabled} placeholder="例如 blue floral pattern" className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-sm" />
    <label className="mt-3 block font-bold" htmlFor={`${id}-reason`}>设计与本人原帖的关系</label>
    <input id={`${id}-reason`} name="designReason" type="text" required minLength={5} maxLength={90}
      disabled={disabled} placeholder="例如 matches the room colors" className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-sm" />
    <p className="mt-1 text-xs text-muted">用简短英文描述，每项 5–90 字符；描述会写入待审回复文案，请只写能核实的内容。</p>

    <label className="mt-3 flex items-start gap-2 text-xs">
      <input name="brandOwned" type="checkbox" required disabled={disabled} className="mt-0.5" />
      <span>我确认上传的是本店原创且有权使用的设计，没有复制原帖或他人的图片。</span>
    </label>
    <button type="submit" disabled={disabled || Boolean(fileError)}
      className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-ink disabled:opacity-50">
      {pending ? "生成中…" : "保存原创设计与商品预览"}
    </button>
    {state.message ? <p role={state.ok ? "status" : "alert"} aria-live="polite"
      className={`mt-2 text-xs ${state.ok ? "text-emerald-700" : "text-red-700"}`}>
      {state.message}
    </p> : null}
  </form>;
}
