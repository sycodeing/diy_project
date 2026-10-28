"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { safeActivityRoute, trackCustomerActivity } from "@/lib/customer-activity-client";

function safeTargetPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function automaticTarget(element: Element) {
  const explicit = element.getAttribute("data-analytics");
  const ariaLabel = element.getAttribute("aria-label");
  const elementId = element.getAttribute("id");
  const elementName = element.getAttribute("name");
  const declared = [explicit, ariaLabel, elementId, elementName]
    .find((value) => value && /^[a-z0-9:_-]{1,64}$/i.test(value));
  if (declared) return declared;

  if (element instanceof HTMLInputElement && element.type === "file") return "file:upload";
  if (element instanceof HTMLAnchorElement) {
    const href = element.getAttribute("href");
    if (!href) return "link";
    if (href.startsWith("#")) return `anchor:${safeTargetPart(href.slice(1)) || "page"}`;
    try {
      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin) return "link:external";
      const routeKey = safeTargetPart(safeActivityRoute(url.pathname).replace(/^\//, ""));
      return `link:${routeKey || "home"}`;
    } catch {
      return "link";
    }
  }
  if (element instanceof HTMLButtonElement) return `button:${element.type || "button"}`;
  return element.tagName.toLowerCase() === "a" ? "link" : "button";
}

export function CustomerActivityTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin") || pathname.startsWith("/auth")) return;
    const route = safeActivityRoute(pathname);
    let lastFlush = Date.now();
    trackCustomerActivity("page_view", { route });
    if (route === "/design") trackCustomerActivity("landing_confirmed", { route });

    const flushDwell = () => {
      const now = Date.now();
      const durationSeconds = Math.min(3600, Math.floor((now - lastFlush) / 1000));
      lastFlush = now;
      if (durationSeconds > 0) {
        trackCustomerActivity("page_exit", { route, durationSeconds }, true);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushDwell();
      else lastFlush = Date.now();
    };
    const onClick = (event: MouseEvent) => {
      const element = (event.target as Element | null)?.closest("a,button,input[type='file'],[role='button']");
      if (!element) return;
      const target = automaticTarget(element);
      trackCustomerActivity("click", { route, target });
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("click", onClick, true);
    window.addEventListener("pagehide", flushDwell);
    return () => {
      flushDwell();
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pagehide", flushDwell);
    };
  }, [pathname]);

  return null;
}
