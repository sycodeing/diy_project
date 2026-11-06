"use client";

import Link from "next/link";
import { useState } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";
import { X_LEAD_REJECTION_REASON_LABELS, X_LEAD_REJECTION_REASONS } from "@/lib/x-lead";
import { blacklistXLeadAccount, createXLeadAutoTask, createXLeadManualTask, setXLeadSuitability, type QueueActionResult } from "./actions";
import type { XLeadAccountOption } from "./page";

type QueueState = {
  href: string;
  label: string;
} | null;

export function CandidateActions({
  actionable,
  accountOptions,
  existingAutomaticTaskLabel,
  existingManualTaskLabel,
  initialRejectionNote,
  initialRejectionReason,
  leadId,
  selectionStatus,
}: {
  actionable: boolean;
  accountOptions: XLeadAccountOption[];
  existingAutomaticTaskLabel?: string;
  existingManualTaskLabel?: string;
  initialRejectionNote: string;
  initialRejectionReason: string;
  leadId: string;
  selectionStatus: string;
}) {
  const [queueState, setQueueState] = useState<QueueState>(existingAutomaticTaskLabel ? {
    href: "/admin/x-auto-posts",
    label: existingAutomaticTaskLabel,
  } : existingManualTaskLabel ? {
    href: "/admin/x-manual-posts",
    label: existingManualTaskLabel,
  } : null);
  const [filtered, setFiltered] = useState(selectionStatus === "rejected");
  const [blacklisted, setBlacklisted] = useState(selectionStatus === "suppressed");
  const [lastRejection, setLastRejection] = useState({
    note: initialRejectionNote,
    reason: initialRejectionReason,
  });
  const [error, setError] = useState<string | null>(null);

  async function runAction(action: () => Promise<void>, onSuccess: () => void) {
    setError(null);
    try {
      await action();
      onSuccess();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "操作失败，请稍后重试。");
    }
  }

  async function runQueueAction(action: () => Promise<QueueActionResult>, onSuccess: () => void) {
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSuccess();
    } catch {
      setError("操作失败，请稍后重试。");
    }
  }

  async function addToManualQueue(formData: FormData) {
    await runQueueAction(
      () => createXLeadManualTask(formData),
      () => setQueueState({ href: "/admin/x-manual-posts", label: "已加入手动队列 · 素材准备中" }),
    );
  }

  async function addToAutoQueue(formData: FormData) {
    await runQueueAction(
      () => createXLeadAutoTask(formData),
      () => setQueueState({ href: "/admin/x-auto-posts", label: "已加入自动队列 · 素材就绪后自动发送" }),
    );
  }

  async function updateSuitability(formData: FormData) {
    const decision = String(formData.get("decision") ?? "");
    const reason = String(formData.get("rejectionReason") ?? "");
    const note = String(formData.get("rejectionNote") ?? "");
    await runAction(
      () => setXLeadSuitability(formData),
      () => {
        setFiltered(decision === "reject");
        if (decision === "reject") setLastRejection({ reason, note });
      },
    );
  }

  async function blacklistAccount(formData: FormData) {
    await runAction(() => blacklistXLeadAccount(formData), () => setBlacklisted(true));
  }

  if (blacklisted) {
    return <ActionStatus href={null} label="已加入账号黑名单 · 当前顺序保持不变，手动刷新后移出候选列表" />;
  }

  return <>
    {error ? <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-800">{error}</p> : null}
    {queueState ? <ActionStatus href={queueState.href} label={`${queueState.label} · 当前顺序保持不变`} /> : actionable && !filtered ? <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
      <form action={addToManualQueue}>
        <input name="leadId" type="hidden" value={leadId} />
        <FormSubmitButton className="focus-ring h-11 w-full rounded-lg bg-foreground px-4 text-sm font-black text-background disabled:opacity-50" idleLabel="加入手动队列" pendingLabel="正在入队…" />
      </form>
      <form action={addToAutoQueue}>
        <input name="leadId" type="hidden" value={leadId} />
        <label className="mb-2 block text-xs font-bold">发送 X 账号<select className="focus-ring mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm" defaultValue="" disabled={!accountOptions.length} name="accountId" required><option disabled value="">请选择账号</option>{accountOptions.map((account) => <option key={account.id} value={account.id}>{account.displayName} · @{account.accountKey}</option>)}</select></label>
        <FormSubmitButton className="focus-ring h-11 w-full rounded-lg bg-accent px-4 text-sm font-black text-accent-ink disabled:opacity-50" disabled={!accountOptions.length} idleLabel="加入并自动发送" pendingLabel="正在入队…" />
      </form>
    </div> : !filtered ? <p className="border-t border-line pt-3 text-xs font-bold text-red-700">参考结论不建议处理，不能加入发送队列。</p> : null}

    {filtered ? <form action={updateSuitability} className="border-t border-line pt-3">
      <p className="mb-2 text-xs leading-5 text-muted"><b>已过滤：</b>{X_LEAD_REJECTION_REASON_LABELS[lastRejection.reason] ?? lastRejection.reason}{lastRejection.note ? ` · ${lastRejection.note}` : ""}</p>
      <p className="mb-2 text-xs font-bold text-emerald-800">本页不会自动刷新或重排；手动刷新后才会移出当前候选位置。</p>
      <input name="leadId" type="hidden" value={leadId} />
      <input name="decision" type="hidden" value="restore" />
      <FormSubmitButton className="focus-ring h-10 w-full rounded-lg border border-line bg-white px-4 text-sm font-black" idleLabel="恢复到候选列表" pendingLabel="正在恢复…" />
    </form> : !queueState && !["approved", "contacted"].includes(selectionStatus) ? <form action={updateSuitability} className="border-t border-line pt-3">
      <input name="leadId" type="hidden" value={leadId} />
      <input name="decision" type="hidden" value="reject" />
      <label className="block text-xs font-bold">过滤原因<select className="focus-ring mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm" defaultValue="" name="rejectionReason" required><option disabled value="">请选择过滤原因</option>{X_LEAD_REJECTION_REASONS.map((reason) => <option key={reason} value={reason}>{X_LEAD_REJECTION_REASON_LABELS[reason]}</option>)}</select></label>
      <label className="mt-2 block text-xs font-bold">其他补充（选择“其他原因”时必填）<input className="focus-ring mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm" maxLength={200} name="rejectionNote" placeholder="可补充具体判断，便于后续优化规则" /></label>
      <FormSubmitButton className="focus-ring mt-3 h-10 w-full rounded-lg border border-red-200 bg-red-50 px-4 text-sm font-black text-red-800" idleLabel="确认过滤并记录原因" pendingLabel="正在过滤…" />
    </form> : null}

    {!queueState && selectionStatus !== "contacted" ? <form action={blacklistAccount} className="border-t border-line pt-3">
      <input name="leadId" type="hidden" value={leadId} />
      <p className="mb-2 text-xs leading-5 text-muted">加入后，该账号现有候选会标记为不再联系，后续筛选也会直接排除。</p>
      <FormSubmitButton className="focus-ring h-10 w-full rounded-lg border border-red-300 bg-white px-4 text-sm font-black text-red-800" idleLabel="将该 X 账号加入黑名单" pendingLabel="正在加入黑名单…" />
    </form> : null}
  </>;
}

function ActionStatus({ href, label }: { href: string | null; label: string }) {
  const className = "focus-ring flex min-h-11 w-full items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-sm font-black text-emerald-900";
  return <div className="border-t border-line pt-3">
    {href ? <Link className={className} href={href}>{label}</Link> : <p className={className}>{label}</p>}
  </div>;
}
