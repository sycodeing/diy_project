"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export function QueueAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || isPending) return;
      startTransition(() => router.refresh());
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [active, isPending, router]);

  return null;
}
