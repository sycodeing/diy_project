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

export function createLegacyMarketingAlias(tokenHash: string) {
  if (!/^[a-f0-9]{64}$/i.test(tokenHash)) throw new Error("Invalid marketing token hash.");
  return Buffer.from(tokenHash.slice(0, 18), "hex").toString("base64url");
}
