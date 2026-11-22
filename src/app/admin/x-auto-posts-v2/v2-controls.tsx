"use client";

import { useActionState, useRef } from "react";
import { addV2Drafts, approveV2Drafts, type V2ActionState } from "./actions";

const initial: V2ActionState = { ok: 0, failed: [] };
type Item = { id: string; label: string; detail: string };

export function V2BatchControls({ kind, items, senders = [] }: { kind: "add" | "approve"; items: Item[]; senders?: Array<{ id: string; label: string }> }) {
  const [state, action, pending] = useActionState(kind === "add" ? addV2Drafts : approveV2Drafts, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const selectAll = (checked: boolean) => formRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    .forEach((box) => { box.checked = checked; });
  return <form ref={formRef} action={action} className="rounded-xl border border-line bg-panel p-4">
    <h2 className="text-lg font-black">{kind === "add" ? "从账号草稿加入 V2 待审" : "人工批准所选 V2 任务"}</h2>
    {kind === "add" ? <label className="mt-3 block text-sm">发送账号
      <select className="ml-2 rounded border border-line bg-surface p-2" name="accountId" required>
        <option value="">请选择</option>{senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.label}</option>)}
      </select>
    </label> : <p className="mt-1 text-xs text-muted">批准后会按共享的账号限额和每日监督规则执行；当前不会批量自动选择。</p>}
    <div className="mt-3 flex gap-3 text-xs"><button type="button" className="text-accent underline" onClick={() => selectAll(true)}>全选</button><button type="button" className="text-accent underline" onClick={() => selectAll(false)}>清空</button></div>
    <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
      {items.map((item) => <label className="flex gap-2 rounded border border-line p-2 text-sm" key={item.id}>
        <input type="checkbox" name={kind === "add" ? "authorId" : "jobId"} value={item.id} />
        <span><strong>{item.label}</strong><span className="ml-2 text-muted">{item.detail}</span></span>
      </label>)}
      {!items.length ? <p className="text-sm text-muted">当前没有可选项目。</p> : null}
    </div>
    <button className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-ink disabled:opacity-50" disabled={pending || !items.length} type="submit">
      {pending ? "处理中…" : kind === "add" ? "加入待审队列" : "批准所选并启动"}
    </button>
    {state.ok || state.failed.length ? <div aria-live="polite" className="mt-3 text-sm">
      <p>成功 {state.ok} 条；失败 {state.failed.length} 条。</p>
      {state.failed.map((failure) => <p className="text-red-700" key={failure.id}>{failure.id}：{failure.reason}</p>)}
    </div> : null}
  </form>;
}
