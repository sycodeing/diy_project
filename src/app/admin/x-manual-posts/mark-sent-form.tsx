"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useActionState } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";
import { discardXManualDraft, markXManualPostSentWithoutRefresh } from "./actions";

const initialState = { ok: false, message: "" };

export function MarkSentForm({ taskId }: { taskId: string }) {
  const [state, action] = useActionState(markXManualPostSentWithoutRefresh, initialState);

  if (state.ok) {
    return <p className="inline-flex h-9 items-center rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-900"><CheckCircle2 className="mr-1.5" size={15} />{state.message}</p>;
  }

  return <>
    <form action={action} className="inline-flex">
      <input name="id" type="hidden" value={taskId} />
      <FormSubmitButton className="focus-ring inline-flex h-9 items-center rounded-md bg-emerald-700 px-3 text-xs font-black text-white disabled:opacity-50" idleLabel="确认已由人工发送" pendingLabel="正在登记…" />
    </form>
    <form action={discardXManualDraft} className="inline-flex"><input name="id" type="hidden" value={taskId} /><button className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-line bg-white px-3 text-xs font-bold" type="submit"><XCircle size={14} />作废当前发送条</button></form>
    {state.message ? <p className="inline-flex min-h-9 items-center text-xs font-bold text-red-700" role="alert">{state.message}</p> : null}
  </>;
}
