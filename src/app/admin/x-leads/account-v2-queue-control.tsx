"use client";

import { useActionState } from "react";
import { addV2Drafts, type V2ActionState } from "@/app/admin/x-auto-posts-v2/actions";

const initial: V2ActionState = { ok: 0, failed: [] };

/** The account card submits the same server-validated, unapproved V2 insert as the batch page. */
export function AccountV2QueueControl({ authorId, senders }: { authorId: string; senders: Array<{ id: string; label: string }> }) {
  const [state, action, pending] = useActionState(addV2Drafts, initial);
  return <form action={action} className="mt-3 rounded-lg border border-accent/40 bg-panel p-3">
    <input type="hidden" name="authorId" value={authorId} />
    <label className="mt-2 block text-xs font-bold" htmlFor={`v2-mode-${authorId}`}>草稿形式</label>
    <select id={`v2-mode-${authorId}`} name="preparationMode" disabled={pending}
      className="mt-1 w-full max-w-sm rounded border border-line bg-surface px-3 py-2 text-sm">
      <option value="auto_preview">自动选原创设计并生成图文预览</option>
      <option value="text_only">明确使用纯文字草稿</option>
    </select>
    <label className="block text-xs font-bold" htmlFor={`v2-sender-${authorId}`}>选择发送账号</label>
    <select id={`v2-sender-${authorId}`} name="accountId" required disabled={pending || !senders.length}
      className="mt-1 w-full max-w-sm rounded border border-line bg-surface px-3 py-2 text-sm">
      <option value="">请选择发送账号</option>
      {senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.label}</option>)}
    </select>
    <button type="submit" disabled={pending || !senders.length}
      className="mt-2 block rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-ink disabled:opacity-50">
      {pending ? "加入中…" : "加入自动队列 V2"}
    </button>
    <p className="mt-1 text-xs text-muted">无可核实设计时图文模式会显示原因并停止加入；可明确选择纯文字。只加入待审队列，仍需单独人工批准。</p>
    {!senders.length ? <p className="mt-1 text-xs text-red-700">没有启用的发送账号，请先到发送账号配置页启用。</p> : null}
    {state.ok || state.failed.length ? <div className="mt-2 text-xs" aria-live="polite">
      {state.ok ? <p className="text-emerald-700">已加入待审队列。请在自动队列 V2 审核。</p> : null}
      {state.failed.map((failure) => <p className="text-red-700" key={`${failure.id}-${failure.reason}`}>加入失败：{failure.reason}</p>)}
    </div> : null}
  </form>;
}
