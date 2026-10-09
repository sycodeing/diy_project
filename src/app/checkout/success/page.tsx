import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { SetupWarning } from "@/components/setup-warning";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; paypal_order_id?: string }>;
}) {
  const { session_id: sessionId, paypal_order_id: paypalOrderId } = await searchParams;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <AppShell>
        <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
          <SetupWarning />
        </main>
      </AppShell>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?next=/orders");
  }

  const { data: order } = sessionId
    ? await supabase
        .from("orders")
        .select("id,order_number,payment_status")
        .eq("stripe_checkout_session_id", sessionId)
        .eq("user_id", user.id)
        .maybeSingle()
    : paypalOrderId
    ? await supabase
        .from("orders")
        .select("id,order_number,payment_status")
        .eq("paypal_order_id", paypalOrderId)
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  if (order?.payment_status === "paid") {
    redirect(`/orders/${order.id}`);
  }

  return (
    <AppShell>
      <main className="mx-auto grid w-full max-w-2xl flex-1 place-items-center px-4 py-16 sm:px-6">
        <section className="w-full rounded-lg border border-line bg-panel/85 p-8 text-center">
          <CheckCircle2 className="mx-auto text-accent" size={48} />
          <h1 className="mt-5 text-4xl font-black tracking-normal">
            Confirming your payment
          </h1>
          <p className="mt-3 text-muted">
            {paypalOrderId
              ? "PayPal is still confirming this payment. This page will update once it is verified."
              : "Stripe is still confirming this payment. This page will update once it is verified."}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              className="focus-ring inline-flex h-11 items-center justify-center rounded-lg bg-accent px-4 font-black text-accent-ink"
              href={order ? `/orders/${order.id}` : "/orders"}
            >
              {order ? `View ${order.order_number}` : "View orders"}
            </Link>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
