import { createHmac } from "node:crypto";

export function createMarketingLinkTokens(secret: string, idempotencyKey: string) {
  const digest = createHmac("sha256", secret)
    .update(`marketing-link:${idempotencyKey}`)
    .digest();
  return {
    preferred: digest.subarray(0, 9).toString("base64url"),
    legacy: digest.toString("base64url"),
  };
}
