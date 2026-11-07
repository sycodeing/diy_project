"use client";

import { useState, useTransition } from "react";
import { selectXLeadMedia } from "./actions";

export function CandidateMediaPicker({
  handle,
  leadId,
  mediaUrl,
  mediaUrls,
  locked,
}: {
  handle: string;
  leadId: string;
  mediaUrl: string;
  mediaUrls: string[] | null;
  locked: boolean;
}) {
  const choices = [...new Set([mediaUrl, ...(mediaUrls ?? [])])].slice(0, 4);
  const [selected, setSelected] = useState(mediaUrl);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function choose(nextUrl: string) {
    if (locked || pending || nextUrl === selected) return;
    const previous = selected;
    setSelected(nextUrl);
    setError("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("leadId", leadId);
      formData.set("mediaUrl", nextUrl);
      try {
        await selectXLeadMedia(formData);
      } catch (reason) {
        setSelected(previous);
        setError(reason instanceof Error ? reason.message : "主图保存失败，请重试。");
      }
    });
  }

  return <div>
    <div className="aspect-square overflow-hidden rounded-lg border border-line bg-surface">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={`@${handle} 的帖子图片`} className="h-full w-full object-contain" src={selected} />
    </div>
    {choices.length > 1 ? <>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {choices.map((choice, index) => <button
          aria-label={`选择第 ${index + 1} 张图片作为主图`}
          className={`focus-ring aspect-square overflow-hidden rounded-md border-2 ${choice === selected ? "border-accent" : "border-line"}`}
          disabled={locked || pending}
          key={choice}
          onClick={() => choose(choice)}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" className="h-full w-full object-cover" src={choice} />
        </button>)}
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-muted">
        {locked ? "已进入素材流程，主图已锁定" : pending ? "正在保存主图…" : `共 ${choices.length} 张，点击缩略图选择主图`}
      </p>
    </> : null}
    {error ? <p className="mt-1 text-[11px] font-bold text-red-700">{error}</p> : null}
  </div>;
}
