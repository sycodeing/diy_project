"use client";

import { ImageOff, LoaderCircle, RotateCcw } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

type AdminAsyncImageProps = {
  alt: string;
  className?: string;
  proxyThroughSite?: boolean;
  sizes?: string;
  src: string;
};

export function AdminAsyncImage({
  ...props
}: AdminAsyncImageProps) {
  return <AdminAsyncImageContent key={props.src} {...props} />;
}

function AdminAsyncImageContent({
  alt,
  className,
  proxyThroughSite = false,
  sizes = "(max-width: 640px) 100vw, 50vw",
  src,
}: AdminAsyncImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");

  const imageClassName = cn(
    "h-full w-full object-cover transition-opacity duration-200",
    status === "loaded" ? "opacity-100" : "opacity-0",
    className,
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface">
      {status === "loading" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface text-xs font-bold text-muted">
          <LoaderCircle aria-hidden="true" className="animate-spin" size={22} />
          <span>图片加载中…</span>
        </div>
      ) : null}
      {status === "failed" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface p-3 text-center text-xs font-bold text-muted">
          <ImageOff aria-hidden="true" size={24} />
          <span>图片加载失败</span>
          <button
            className="focus-ring inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-foreground"
            onClick={() => {
              setStatus("loading");
              setAttempt((value) => value + 1);
            }}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={13} />重新加载
          </button>
        </div>
      ) : null}
      {proxyThroughSite ? (
        <Image
          alt={alt}
          className={imageClassName}
          fill
          key={`${src}-${attempt}`}
          onError={() => setStatus("failed")}
          onLoad={() => setStatus("loaded")}
          sizes={sizes}
          src={src}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={alt}
          className={imageClassName}
          decoding="async"
          key={`${src}-${attempt}`}
          loading="lazy"
          onError={() => setStatus("failed")}
          onLoad={() => setStatus("loaded")}
          src={src}
        />
      )}
    </div>
  );
}
