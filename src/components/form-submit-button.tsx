"use client";

import { useFormStatus } from "react-dom";

export function FormSubmitButton({
  className,
  idleLabel,
  pendingLabel = "处理中…",
}: {
  className: string;
  idleLabel: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className={className}
      disabled={pending}
      type="submit"
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
