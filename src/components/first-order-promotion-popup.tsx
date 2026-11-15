"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { FIRST_ORDER_PROMOTION_DISMISSED_DATE_KEY, localDateKey, wasPromotionDismissedToday } from "@/lib/promotion-frequency";

export function FirstOrderPromotionPopup({ priceCents, currency }: { priceCents: number; currency: string }) {
  const [open, setOpen] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      if (wasPromotionDismissedToday(window.localStorage.getItem(FIRST_ORDER_PROMOTION_DISMISSED_DATE_KEY), new Date())) return;
    } catch {
      // Storage can be unavailable in privacy-restricted browsers; keep the offer usable.
    }
    const frame = window.requestAnimationFrame(() => setOpen(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === FIRST_ORDER_PROMOTION_DISMISSED_DATE_KEY && wasPromotionDismissedToday(event.newValue, new Date())) {
        setOpen(false);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
      if (event.key === "Tab") {
        const dialog = closeButton.current?.closest('[role="dialog"]');
        const controls = dialog?.querySelectorAll<HTMLElement>("button, a[href]");
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  function dismiss() {
    try {
      window.localStorage.setItem(FIRST_ORDER_PROMOTION_DISMISSED_DATE_KEY, localDateKey(new Date()));
    } catch {
      // A blocked storage write should not prevent closing the dialog.
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/60 px-4 py-4 backdrop-blur-sm sm:px-6" role="presentation">
      <section
        aria-describedby="first-order-promotion-description"
        aria-labelledby="first-order-promotion-title"
        aria-modal="true"
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-panel p-5 text-foreground shadow-2xl sm:p-8"
        role="dialog"
      >
        <button
          ref={closeButton}
          aria-label="Close offer"
          className="focus-ring absolute right-3 top-3 grid size-11 place-items-center rounded-lg text-muted hover:bg-surface hover:text-foreground"
          onClick={dismiss}
          type="button"
        >
          <X size={20} />
        </button>
        <p className="pr-10 text-xs font-black uppercase tracking-[0.15em] text-accent">First order offer</p>
        <h2 className="mt-4 pr-5 text-3xl font-black leading-tight tracking-tight sm:text-4xl" id="first-order-promotion-title">
          Your first custom order for {formatMoney(priceCents, currency)}.
        </h2>
        <p className="mt-4 text-sm leading-6 text-muted" id="first-order-promotion-description">
          Upload a photo, preview your design, and get the first-order price automatically at checkout. No code needed.
        </p>
        <p className="mt-3 text-xs leading-5 text-muted">
          US shipping included · Review product details before checkout
        </p>
        <Link
          className="focus-ring mt-6 flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-5 text-center font-black text-accent-ink hover:bg-accent-strong"
          href="/design"
          onClick={dismiss}
        >
          Create your preview
        </Link>
        <button className="focus-ring mt-3 min-h-11 w-full rounded-lg text-sm font-semibold text-muted hover:text-foreground" onClick={dismiss} type="button">
          Maybe later
        </button>
      </section>
    </div>
  );
}
