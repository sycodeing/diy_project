"use client";

import Image from "next/image";
import { useState } from "react";

export function RawPostPhotos({ urls, postUrl }: { urls: string[]; postUrl: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  if (!urls.length) return null;
  const visible = urls.filter((url) => !failed.includes(url));
  return <div className="mt-3">
    <p className="mb-2 text-xs font-bold text-muted">原帖图片，未核验宠物归属</p>
    {visible.length ? <div className="flex flex-wrap gap-2">{visible.map((url, index) =>
      <a key={url} className="relative block h-28 w-28 overflow-hidden rounded-lg border border-line bg-surface" href={url} target="_blank" rel="noopener noreferrer" aria-label={`打开原帖图片 ${index + 1}`}>
        <Image src={url} alt={`原帖图片 ${index + 1}，未核验宠物归属`} fill sizes="112px" className="object-cover" onError={() => setFailed((current) => current.includes(url) ? current : [...current, url])} />
      </a>)}</div>
      : <a className="text-xs font-bold text-accent underline" href={postUrl} target="_blank" rel="noopener noreferrer">图片暂不可用，打开原帖查看</a>}
  </div>;
}
