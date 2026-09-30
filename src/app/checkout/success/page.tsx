import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { SetupWarning } from "@/components/setup-warning";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;
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
        .select("id,order_number")
        .eq("stripe_checkout_session_id", sessionId)
        .maybeSingle()
    : { data: null };

  return (
    <AppShell>
      <main className="mx-auto grid w-full max-w-2xl flex-1 place-items-center px-4 py-16 sm:px-6">
        <section className="w-full rounded-lg border border-line bg-panel/85 p-8 text-center">
          <CheckCircle2 className="mx-auto text-accent" size={48} />
          <h1 className="mt-5 text-4xl font-black tracking-normal">
            Payment received
          </h1>
          <p className="mt-3 text-muted">
            Stripe is confirming the payment. Once confirmed, the order will
            enter the next scheduled Temu payment batch.
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
