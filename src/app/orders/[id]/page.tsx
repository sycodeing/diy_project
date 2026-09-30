import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DesignSummary } from "@/components/design-summary";
import { CustomerOrderStatus } from "@/components/order-status";
import { SetupWarning } from "@/components/setup-warning";
import { createDesignImageUrls } from "@/lib/design-images";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OrderSummary } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/utils";

type CustomerOrderDetail = Pick<
  OrderSummary,
  | "id"
  | "order_number"
  | "amount_cents"
  | "currency"
  | "payment_status"
  | "design_snapshot"
  | "created_at"
>;

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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
    redirect(`/auth?next=/orders/${id}`);
  }

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id,order_number,amount_cents,currency,payment_status,design_snapshot,created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!order) {
    notFound();
  }

  const typedOrder = order as CustomerOrderDetail;
  const imageUrls = await createDesignImageUrls(
    supabase,
    typedOrder.design_snapshot,
  );
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <Link className="text-sm font-bold text-muted hover:text-foreground" href="/orders">
          Back to orders
        </Link>

        <section className="mt-5 rounded-lg border border-line bg-panel/85 p-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-sm text-accent">
                {typedOrder.order_number}
              </p>
              <h1 className="mt-2 text-4xl font-black tracking-normal">
                Custom Pillow Cover Set order
              </h1>
              <p className="mt-2 text-sm text-muted">
                Created {formatDate(typedOrder.created_at)}
              </p>
            </div>
            <p className="text-2xl font-black">
              {formatMoney(typedOrder.amount_cents, typedOrder.currency)}
            </p>
          </div>

          <CustomerOrderStatus paymentStatus={typedOrder.payment_status} />

          <div className="mt-6">
            <DesignSummary
              design={typedOrder.design_snapshot}
              imageUrls={imageUrls}
            />
          </div>
        </section>

      </main>
    </AppShell>
  );
}
