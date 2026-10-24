import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sendPaymentTriggerTestEmail } from "@/lib/first-payment-trigger-alert";

export const runtime = "nodejs";

export async function POST() {
  await requireAdmin("/admin/orders");

  const result = await sendPaymentTriggerTestEmail();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  if (result.status === "not-configured") {
    return NextResponse.json(
      { error: "Payment-trigger email is not configured." },
      { status: 503 },
    );
  }

  return NextResponse.json({ sent: true, emailId: result.emailId });
}
