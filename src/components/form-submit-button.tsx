"use client";

import { useFormStatus } from "react-dom";

export function FormSubmitButton({
  className,
  disabled = false,
  idleLabel,
  pendingLabel = "处理中…",
}: {
  className: string;
  disabled?: boolean;
  idleLabel: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className={className}
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
