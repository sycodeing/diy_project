import Link from "next/link";
import { Package, Shield } from "lucide-react";
import { getCurrentUser, getIsAdmin } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const isAdmin = await getIsAdmin();

  return (
    <div className="grain min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-line bg-background/88 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg border border-line bg-foreground text-background">
              <Package size={18} strokeWidth={2} />
            </span>
            <span className="leading-none">
              <span className="block text-sm font-black uppercase tracking-[0.18em]">
                Studio Blank
              </span>
              <span className="block text-xs text-muted">DIY drop desk</span>
            </span>
          </Link>

          <nav className="flex items-center gap-2 text-sm">
            <Link
              className="focus-ring hidden rounded-lg px-3 py-2 text-muted transition hover:bg-white/5 hover:text-foreground sm:inline-flex"
              href="/orders"
            >
              Orders
            </Link>
            {isAdmin ? (
              <Link
                className="focus-ring hidden items-center gap-2 rounded-lg px-3 py-2 text-muted transition hover:bg-white/5 hover:text-foreground sm:inline-flex"
                href="/admin/orders"
              >
                <Shield size={15} />
                Admin
              </Link>
            ) : null}
            {user ? (
              <>
                <Link
                  className="focus-ring inline-flex size-10 items-center justify-center rounded-lg border border-line bg-white/5 text-foreground sm:hidden"
                  href="/orders"
                  aria-label="Orders"
                >
                  <Package size={18} />
                </Link>
                <SignOutButton />
              </>
            ) : (
              <Link
                className="focus-ring rounded-lg bg-accent px-4 py-2 font-bold text-accent-ink transition hover:bg-foreground active:translate-y-px"
                href="/auth"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
