import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getActiveMarketingLinkFromCookie,
  recordMarketingEvent,
} from "@/lib/marketing";
import { ACTIVITY_SESSION_COOKIE } from "@/lib/customer-activity";

const schema = z.object({
  eventType: z.enum(["design_opened", "preview_ready"]),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  }

  const link = await getActiveMarketingLinkFromCookie();
  if (!link) return new NextResponse(null, { status: 204 });

  const cookieHeader = request.headers.get("cookie") ?? "";
  const activitySessionId = readCookie(cookieHeader, ACTIVITY_SESSION_COOKIE);
  const isInternal = /(?:^|;\s*)diy_internal_test=1(?:;|$)/.test(cookieHeader);
  const { error } = await recordMarketingEvent(
    link.id,
    parsed.data.eventType,
    {},
    undefined,
    /^[0-9a-f-]{36}$/i.test(activitySessionId) ? activitySessionId : undefined,
    isInternal,
  );
  if (error) {
    return NextResponse.json({ error: "Could not record event." }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}

function readCookie(header: string, name: string) {
  const encoded = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
  try { return decodeURIComponent(encoded); } catch { return ""; }
}
