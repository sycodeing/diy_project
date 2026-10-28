import { classifyReferrer } from "@/lib/traffic-classification";

export type ClientActivityEventType =
  | "page_view"
  | "page_exit"
  | "click"
  | "landing_confirmed"
  | "design_opened"
  | "upload_started"
  | "crop_confirmed"
  | "preview_started"
  | "preview_cache_hit"
  | "preview_ready"
  | "delivery_opened"
  | "delivery_canceled"
  | "address_validation_failed"
  | "payment_redirected";

let activityQueue: Promise<void> = Promise.resolve();

export function trackCustomerActivity(
  eventType: ClientActivityEventType,
  details: { route?: string; target?: string; durationSeconds?: number } = {},
  keepalive = false,
): Promise<boolean> {
  syncInternalTestCookie();
  const event = {
    eventId: crypto.randomUUID(),
    eventType,
    route: details.route ?? safeActivityRoute(window.location.pathname),
    target: details.target,
    durationSeconds: details.durationSeconds,
    referrerGroup: classifyReferrer(document.referrer, window.location.origin),
  };
  const body = JSON.stringify(event);
  if (keepalive && navigator.sendBeacon) {
    return Promise.resolve(navigator.sendBeacon("/api/activity", new Blob([body], { type: "application/json" })));
  }
  const request = activityQueue.then(async () => {
    const response = await fetch("/api/activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive,
      credentials: "same-origin",
    });
    if (!response.ok) {
      console.warn("Customer activity could not be recorded", { eventType, status: response.status });
    }
    return response.ok;
  }).catch((error) => {
    console.warn("Customer activity could not be recorded", { eventType, error });
    return false;
  });
  activityQueue = request.then(() => undefined);
  return request;
}

function syncInternalTestCookie() {
  const flag = new URLSearchParams(window.location.search).get("internal_test");
  if (flag === "1") document.cookie = "diy_internal_test=1; Max-Age=2592000; Path=/; SameSite=Lax";
  if (flag === "0") document.cookie = "diy_internal_test=; Max-Age=0; Path=/; SameSite=Lax";
}

export function safeActivityRoute(pathname: string) {
  return pathname
    .replace(/\/go\/[^/]+/g, "/go/:token")
    .replace(/\/orders\/[^/]+/g, "/orders/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/:id")
    .slice(0, 160);
}
