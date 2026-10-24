"use client";

import { Check, Download, LoaderCircle, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type DownloadStatus = "idle" | "pending" | "processing" | "completed" | "failed";

export function CopyImageButton({ taskId, status }: { taskId: string; status: DownloadStatus }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const working = submitting || status === "pending" || status === "processing";

  return (
    <button
      className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-line bg-white px-3 text-xs font-black text-muted hover:text-foreground disabled:opacity-60"
      disabled={working}
      onClick={async () => {
        setSubmitting(true);
        setFailed(false);
        try {
          const response = await fetch("/api/x-leads/preview-downloads", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ taskId }),
          });
          if (!response.ok) throw new Error("Preview download request failed.");
          router.refresh();
        } catch {
          setFailed(true);
        } finally {
          setSubmitting(false);
        }
      }}
      type="button"
    >
      {working ? <LoaderCircle className="animate-spin" size={14} /> : status === "completed" ? <Check size={14} /> : failed || status === "failed" ? <TriangleAlert size={14} /> : <Download size={14} />}
      {working ? "等待本机下载" : status === "completed" ? "重新下载到本地" : failed ? "提交失败，重试" : status === "failed" ? "下载失败，重试" : "下载预览图到本地"}
    </button>
  );
}
