"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "input", "scroll", "touchstart"];

export function IdleAutoRefresh({ idleMs = 30_000 }: { idleMs?: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => {
    let timer: number | undefined;

    const scheduleRefresh = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          startTransition(() => router.refresh());
        }
        scheduleRefresh();
      }, idleMs);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, scheduleRefresh, { capture: true, passive: true });
    });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    scheduleRefresh();

    return () => {
      if (timer) window.clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, scheduleRefresh, { capture: true });
      });
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [idleMs, router, startTransition]);

  return null;
}
