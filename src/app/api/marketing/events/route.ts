import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getActiveMarketingLinkFromCookie,
  recordMarketingEvent,
} from "@/lib/marketing";

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

  const { error } = await recordMarketingEvent(link.id, parsed.data.eventType);
  if (error) {
    return NextResponse.json({ error: "Could not record event." }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
