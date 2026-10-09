import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { POLICY_EFFECTIVE_DATE } from "@/lib/public-site";

const policyLinks = [
  { href: "/contact", label: "Contact us" },
  { href: "/privacy", label: "Privacy policy" },
  { href: "/terms", label: "Terms and conditions" },
  { href: "/returns", label: "Returns and refunds" },
  { href: "/shipping", label: "Shipping and delivery" },
] as const;

export function PolicyPage({
  children,
  currentPath,
  intro,
  title,
}: {
  children: React.ReactNode;
  currentPath: string;
  intro: string;
  title: string;
}) {
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <header className="max-w-3xl">
          <h1 className="text-4xl font-black tracking-[-0.035em] sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted">{intro}</p>
          <p className="mt-4 text-sm font-medium text-muted">
            Effective {POLICY_EFFECTIVE_DATE}
          </p>
        </header>

        <div className="mt-10 grid gap-10 border-t border-line pt-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-14">
          <aside>
            <nav aria-label="Store policy pages" className="grid gap-1 sm:grid-cols-2 lg:sticky lg:top-24 lg:grid-cols-1">
              {policyLinks.map((link) => {
                const active = link.href === currentPath;
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`focus-ring rounded-lg px-3 py-2.5 text-sm font-bold transition ${
                      active
                        ? "bg-accent-soft text-accent-strong"
                        : "text-muted hover:bg-surface hover:text-foreground"
                    }`}
                    href={link.href}
                    key={link.href}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </aside>

          <article className="min-w-0 max-w-3xl space-y-10">{children}</article>
        </div>
      </main>
    </AppShell>
  );
}

export function PolicySection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section>
      <h2 className="text-2xl font-black tracking-[-0.025em]">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-7 text-muted">{children}</div>
    </section>
  );
}

export function PolicyList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-accent">{children}</ul>;
}
