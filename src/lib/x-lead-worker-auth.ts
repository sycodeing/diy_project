import "server-only";

import { timingSafeEqual } from "node:crypto";
import { getMarketingIngestSecret } from "@/lib/env";

export function isAuthorizedXLeadWorker(request: Request) {
  const secret = getMarketingIngestSecret();
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !authorization.startsWith("Bearer ")) return false;

  const supplied = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

