"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export function QueueAutoRefresh({ active, intervalMs = 10_000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || isPending) return;
      startTransition(() => router.refresh());
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs, isPending, router]);

  return null;
}
