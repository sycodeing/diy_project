"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { addV2Drafts, approveV2Drafts, type V2ActionState } from "./actions";
import { useXSenderAccount } from "@/lib/use-x-sender-account";

const initial: V2ActionState = { ok: 0, failed: [] };
type Item = { id: string; label: string; detail: string };
type Props = { kind: "add" | "approve"; items: Item[]; senders?: Array<{ id: string; label: string }> };

export function V2BatchControls(props: Props) {
  return props.kind === "add" ? <V2AddControls {...props} /> : <V2ApproveControls items={props.items} />;
}

function Selection({ items, name, formRef }: { items: Item[]; name: string; formRef: React.RefObject<HTMLFormElement | null> }) {
  const selectAll = (checked: boolean) => formRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    .forEach((box) => { box.checked = checked; });
  return <><div className="mt-3 flex gap-3 text-xs"><button type="button" className="text-accent underline" onClick={() => selectAll(true)}>全选</button><button type="button" className="text-accent underline" onClick={() => selectAll(false)}>清空</button></div>
    <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">{items.map((item) => <label className="flex gap-2 rounded border border-line p-2 text-sm" key={item.id}>
      <input type="checkbox" name={name} value={item.id} /><span><strong>{item.label}</strong><span className="ml-2 text-muted">{item.detail}</span></span>
    </label>)}{!items.length ? <p className="text-sm text-muted">当前没有可选项目。</p> : null}</div></>;
}

function V2AddControls({ items, senders = [] }: Props) {
  const [selectedAccountId, changeDefaultAccount] = useXSenderAccount(senders);
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<V2ActionState>(initial);
  async function submit(form: HTMLFormElement) {
    setBusy(true);
    try {
    const values = new FormData(form);
    const ids = [...new Set(values.getAll("authorId").map(String))];
    setTotal(ids.length); setDone(0); setState(initial);
    const aggregate: V2ActionState = { ok: 0, failed: [] };
    for (const authorId of ids) {
      const single = new FormData();
      single.set("authorId", authorId);
      single.set("accountId", String(values.get("accountId") ?? ""));
      single.set("preparationMode", String(values.get("preparationMode") ?? "auto_preview"));
      try {
        const result = await addV2Drafts(initial, single);
        aggregate.ok += result.ok;
        aggregate.failed.push(...result.failed);
      } catch (error) {
        aggregate.failed.push({ id: authorId, reason: error instanceof Error ? error.message : "准备失败" });
      }
      setDone(aggregate.ok + aggregate.failed.length);
      setState({ ok: aggregate.ok, failed: [...aggregate.failed] });
    }
    } finally { setBusy(false); }
  }
  return <form ref={formRef} onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; startTransition(async () => { await submit(form); }); }}
    className="rounded-xl border border-line bg-panel p-4">
    <h2 className="text-lg font-black">从账号草稿加入 V2 待审</h2>
    <label className="mt-3 block text-sm">发送账号<select className="ml-2 rounded border border-line bg-surface p-2" name="accountId" required disabled={pending || busy || !senders.length}
      value={selectedAccountId} onChange={(event) => changeDefaultAccount(event.target.value)}>
      <option value="">请选择</option>{senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.label}</option>)}
    </select></label>
    <label className="mt-2 block text-sm">准备方式<select className="ml-2 rounded border border-line bg-surface p-2" name="preparationMode" disabled={pending || busy}>
      <option value="auto_preview">自动设计图文预览</option><option value="text_only">明确纯文字</option>
    </select></label>
    <Selection items={items} name="authorId" formRef={formRef} />
    <button className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-ink disabled:opacity-50" disabled={pending || busy || !items.length || !selectedAccountId} type="submit">
      {pending || busy ? `逐条准备中 ${done}/${total}` : "逐条准备并加入待审队列"}</button>
    <p className="mt-1 text-xs text-muted">每个账号单独准备并保存进度；失败或没有可靠设计会显示原因，刷新后可继续选择剩余账号。加入不等于批准。</p>
    {state.ok || state.failed.length ? <div aria-live="polite" className="mt-3 text-sm"><p>成功 {state.ok} 条；失败 {state.failed.length} 条。</p>
      {state.failed.map((failure) => <p className="text-red-700" key={failure.id}>{failure.id}：{failure.reason}</p>)}</div> : null}
  </form>;
}

function V2ApproveControls({ items }: { items: Item[] }) {
  const [state, action, pending] = useActionState(approveV2Drafts, initial);
  const formRef = useRef<HTMLFormElement>(null);
  return <form ref={formRef} action={action} className="rounded-xl border border-line bg-panel p-4">
    <h2 className="text-lg font-black">人工批准所选 V2 任务</h2>
    <p className="mt-1 text-xs text-muted">批准后会按共享的账号限额和每日监督规则执行；当前不会批量自动选择。</p>
    <Selection items={items} name="jobId" formRef={formRef} />
    <button className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-ink disabled:opacity-50" disabled={pending || !items.length} type="submit">
      {pending ? "处理中…" : "批准所选并启动"}</button>
    {state.ok || state.failed.length ? <div aria-live="polite" className="mt-3 text-sm"><p>成功 {state.ok} 条；失败 {state.failed.length} 条。</p>
      {state.failed.map((failure) => <p className="text-red-700" key={failure.id}>{failure.id}：{failure.reason}</p>)}</div> : null}
  </form>;
}
