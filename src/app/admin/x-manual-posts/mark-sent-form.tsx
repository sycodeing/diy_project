"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useActionState } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";
import { discardXManualDraft, markXManualPostSentWithoutRefresh } from "./actions";

const initialState = { ok: false, message: "" };

export function MarkSentForm({ taskId }: { taskId: string }) {
  const [state, action] = useActionState(markXManualPostSentWithoutRefresh, initialState);

  if (state.ok) {
    return <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-900"><CheckCircle2 className="mr-2 inline" size={17} />{state.message}</p>;
  }

  return <>
    <form action={action}>
      <input name="id" type="hidden" value={taskId} />
      <label className="mt-3 block text-sm font-bold">发送后的帖子链接（可选）<input className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3" name="resultUrl" placeholder="https://x.com/your_account/status/123..." /></label>
      {state.message ? <p className="mt-2 text-sm font-bold text-red-700" role="alert">{state.message}</p> : null}
      <FormSubmitButton className="focus-ring mt-3 h-10 rounded-lg bg-emerald-700 px-4 text-sm font-black text-white disabled:opacity-50" idleLabel="确认已由人工发送" pendingLabel="正在登记…" />
    </form>
    <form action={discardXManualDraft} className="mt-2"><input name="id" type="hidden" value={taskId} /><button className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-line px-3 text-xs font-bold" type="submit"><XCircle size={14} />作废当前发送条</button></form>
  </>;
}
