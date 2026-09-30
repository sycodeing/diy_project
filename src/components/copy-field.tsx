"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function CopyField({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-start justify-between gap-3 border-b border-line/70 py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-muted">
          {label}
        </p>
        <p className={`mt-1 break-words text-sm text-foreground ${multiline ? "whitespace-pre-line" : ""}`}>
          {value || "—"}
        </p>
      </div>
      <button
        aria-label={`复制${label}`}
        className="focus-ring mt-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-xs font-bold text-muted hover:text-foreground"
        disabled={!value}
        onClick={async () => {
          await copyToClipboard(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
        type="button"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}

export function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      aria-label={label}
      className="focus-ring inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-xs font-bold text-muted hover:text-foreground"
      disabled={!value}
      onClick={async () => {
        await copyToClipboard(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
      type="button"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "已复制" : label}
    </button>
  );
}
