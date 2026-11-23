import { getAppUrl, getXLeadWorkerSecret } from "@/lib/env";

/** Fresh contact guard shared by the admin action and controlled local batch preparation. */
export async function contactedSnapshot() {
  const secret = getXLeadWorkerSecret();
  if (!secret) throw new Error("Contacted snapshot is not configured");
  const response = await fetch(`${getAppUrl()}/api/x-leads/worker/contacted-snapshot`, {
    headers: { authorization: `Bearer ${secret}` }, cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Contacted snapshot is unavailable");
  const value = await response.json() as { author_ids?: unknown; handles?: unknown; post_ids?: unknown };
  if (!Array.isArray(value.author_ids) || !Array.isArray(value.handles) || !Array.isArray(value.post_ids))
    throw new Error("Contacted snapshot is incomplete");
  return { authors: new Set(value.author_ids.map(String)), handles: new Set(value.handles.map(String)),
    posts: new Set(value.post_ids.map(String)) };
}
