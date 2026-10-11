import { NextResponse } from "next/server";
import { getActiveMarketingLinkFromCookie, linkMarketingAccount } from "@/lib/marketing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const [{ data: { user } }, marketingLink] = await Promise.all([
    supabase.auth.getUser(),
    getActiveMarketingLinkFromCookie(),
  ]);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!marketingLink) return new NextResponse(null, { status: 204 });

  const { error } = await linkMarketingAccount(marketingLink, user);
  if (error) {
    console.error("Marketing account attribution failed", {
      error: error.message,
      marketingLinkId: marketingLink.id,
      userId: user.id,
    });
    return NextResponse.json({ error: "Could not link marketing attribution." }, { status: 409 });
  }
  return new NextResponse(null, { status: 204 });
}
