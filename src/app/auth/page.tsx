import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AuthForm } from "@/components/auth-form";
import { SetupWarning } from "@/components/setup-warning";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseBrowserConfig } from "@/lib/env";

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const nextPath = next?.startsWith("/") ? next : "/";
  const user = await getCurrentUser();

  if (user) {
    redirect(nextPath);
  }

  return (
    <AppShell>
      <main className="mx-auto grid w-full max-w-5xl flex-1 gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_420px] lg:py-20">
        <section className="flex flex-col justify-center">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">
            Account access
          </p>
          <h1 className="mt-3 max-w-2xl text-5xl font-black leading-[0.95] tracking-normal sm:text-7xl">
            Save proofs. Pay clean. Track production.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-muted">
            Use email and password to keep custom designs, payment history, and
            order status tied to one studio account.
          </p>
        </section>
        <section className="flex items-center justify-center">
          {getSupabaseBrowserConfig() ? (
            <AuthForm nextPath={nextPath} />
          ) : (
            <SetupWarning />
          )}
        </section>
      </main>
    </AppShell>
  );
}

