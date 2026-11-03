"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormSubmitButton } from "@/components/form-submit-button";
import { approveXAutoBatch, approveXAutoDraft } from "./actions";

type ApprovalFormProps =
  | { mode: "batch"; readyCount: number }
  | { mode: "single"; jobId: string };

export function ApprovalForm(props: ApprovalFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const batch = props.mode === "batch";

  async function submit(formData: FormData) {
    setError(null);
    const result = batch
      ? await approveXAutoBatch(formData)
      : await approveXAutoDraft(formData);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    const notice = batch ? "batch-approved" : "approved";
    router.replace(`/admin/x-auto-posts?notice=${notice}&count=${result.approvedCount}`);
    router.refresh();
  }

  return (
    <>
      <form action={submit} id={batch ? "batch-approve-form" : undefined}>
        {!batch ? <input name="jobId" type="hidden" value={props.jobId} /> : null}
        <FormSubmitButton
          className={batch
            ? "focus-ring h-11 rounded-lg bg-accent px-4 text-sm font-black text-accent-ink disabled:opacity-50"
            : "focus-ring h-10 rounded-lg bg-accent px-4 text-sm font-black text-accent-ink disabled:opacity-50"}
          disabled={batch && props.readyCount === 0}
          idleLabel={batch
            ? `批准选中并批量发送${props.readyCount ? `（可选 ${props.readyCount} 条）` : ""}`
            : "仅发送这一条"}
          pendingLabel={batch ? "正在批量检查账号与队列…" : "正在检查本机账号…"}
        />
      </form>
      {error ? <p aria-live="polite" className="basis-full rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800" role="alert">{error}</p> : null}
    </>
  );
}
