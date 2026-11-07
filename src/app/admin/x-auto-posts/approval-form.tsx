"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormSubmitButton } from "@/components/form-submit-button";
import { startAllXAutoSending } from "./actions";

export function StartAllForm({ preparingCount, readyCount }: { preparingCount: number; readyCount: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const result = await startAllXAutoSending();

    if (!result.ok) {
      setError(result.error);
      return;
    }

    router.replace(`/admin/x-auto-posts?notice=all-started&count=${result.approvedCount}`);
    router.refresh();
  }

  return (
    <>
      <form action={submit}>
        <FormSubmitButton
          className="focus-ring h-11 rounded-lg bg-accent px-4 text-sm font-black text-accent-ink disabled:opacity-50"
          disabled={readyCount === 0 || preparingCount > 0}
          idleLabel={preparingCount > 0
            ? `等待 ${preparingCount} 条素材准备完成`
            : `开始全部发送${readyCount ? `（${readyCount} 条）` : ""}`}
          pendingLabel="正在检查全部账号与队列…"
        />
      </form>
      {error ? <p aria-live="polite" className="basis-full rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800" role="alert">{error}</p> : null}
    </>
  );
}
