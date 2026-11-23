"use client";

import { useActionState, useState } from "react";
import { addV2Drafts, type V2ActionState } from "@/app/admin/x-auto-posts-v2/actions";
import { useXSenderAccount } from "@/lib/use-x-sender-account";

const initial: V2ActionState = { ok: 0, failed: [] };

/** The account card submits the same server-validated, unapproved V2 insert as the batch page. */
export function AccountV2QueueControl({ authorId, senders, automaticPreviewBlockReason, automaticPreviewFallback, savedFallbackPreview }: {
  authorId: string;
  senders: Array<{ id: string; label: string }>;
  automaticPreviewBlockReason?: string | null;
  automaticPreviewFallback?: boolean;
  savedFallbackPreview?: boolean;
}) {
  const [state, action, pending] = useActionState(addV2Drafts, initial);
  const [selectedAccountId, changeDefaultAccount] = useXSenderAccount(senders);
  const [preparationMode, setPreparationMode] = useState("auto_preview");
  const modeNeedsSelection = !preparationMode || preparationMode === "auto_preview" && Boolean(automaticPreviewBlockReason);
  return <form action={action} className="mt-3 rounded-lg border border-accent/40 bg-panel p-3">
    <input type="hidden" name="authorId" value={authorId} />
    <label className="mt-2 block text-xs font-bold" htmlFor={`v2-mode-${authorId}`}>草稿形式</label>
    <select id={`v2-mode-${authorId}`} name="preparationMode" disabled={pending} required
      value={modeNeedsSelection ? "" : preparationMode} onChange={(event) => setPreparationMode(event.target.value)}
      aria-describedby={automaticPreviewBlockReason ? `v2-design-reason-${authorId}` : undefined}
      className="mt-1 w-full max-w-sm rounded border border-line bg-surface px-3 py-2 text-sm">
      {automaticPreviewBlockReason ? <option value="" disabled>请选择草稿形式</option> : null}
      <option value="auto_preview" disabled={Boolean(automaticPreviewBlockReason)}>自动选原创设计并生成图文预览</option>
      <option value="text_only">明确使用纯文字草稿</option>
    </select>
    {automaticPreviewBlockReason ? <p id={`v2-design-reason-${authorId}`} className="mt-1 text-xs text-amber-800">
      暂无可自动生成的图文设计：{automaticPreviewBlockReason}。请选择“明确使用纯文字草稿”后加入，或先手动上传本店原创设计；补充证据后也可重新生成图文。
    </p> : null}
    {automaticPreviewFallback ? <p className="mt-1 text-xs text-muted">未提供明确颜色或主题，将生成本店中性条纹方案供参考。</p> : null}
    {savedFallbackPreview ? <p className="mt-1 text-xs text-muted">中性起点预览 · 本店建议配色，并非从用户原帖提取。</p> : null}
    <label className="block text-xs font-bold" htmlFor={`v2-sender-${authorId}`}>选择发送账号</label>
    <select id={`v2-sender-${authorId}`} name="accountId" required disabled={pending || !senders.length}
      value={selectedAccountId} onChange={(event) => changeDefaultAccount(event.target.value)}
      className="mt-1 w-full max-w-sm rounded border border-line bg-surface px-3 py-2 text-sm">
      <option value="">请选择发送账号</option>
      {senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.label}</option>)}
    </select>
    <button type="submit" disabled={pending || !selectedAccountId || modeNeedsSelection}
      className="mt-2 block rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-ink disabled:opacity-50">
      {pending ? "加入中…" : "加入自动队列 V2"}
    </button>
    <p className="mt-1 text-xs text-muted">发送账号会在不同候选、分页及候选页面间保持一致。</p>
    <p className="mt-1 text-xs text-muted">未提供颜色或主题时可生成中性起点预览；其他无法匹配的设计仍显示原因并停止图文加入，也可明确选择纯文字。只加入待审队列，仍需单独人工批准。</p>
    {!senders.length ? <p className="mt-1 text-xs text-red-700">没有启用的发送账号，请先到发送账号配置页启用。</p> : null}
    {state.ok || state.failed.length ? <div className="mt-2 text-xs" aria-live="polite">
      {state.ok ? <p className="text-emerald-700">已加入待审队列。请在自动队列 V2 审核。</p> : null}
      {state.failed.map((failure) => <p className="text-red-700" key={`${failure.id}-${failure.reason}`}>加入失败：{failure.reason}</p>)}
    </div> : null}
  </form>;
}
