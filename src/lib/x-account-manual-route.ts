import { createHash } from "node:crypto";

/** Server-only configuration identity; never proof of a live X session. */
export function manualRouteRevision(accountId: string, encryptedProxy: string, expectedIp: string) {
  return createHash("sha256").update(JSON.stringify([accountId, "fixed_proxy", encryptedProxy, expectedIp])).digest("hex");
}
