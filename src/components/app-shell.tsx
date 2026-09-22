import Link from "next/link";
import { ImageUp, Package, Shield, UserRound } from "lucide-react";
import { getCurrentUser, getIsAdmin } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const isAdmin = await getIsAdmin();
  const avatarUrl = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture;
  const nickname =
    user?.user_metadata?.display_name ??
    user?.user_metadata?.full_name ??
    user?.user_metadata?.name;

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
              aria-label="Design"
              className="focus-ring inline-flex size-10 items-center justify-center rounded-lg text-muted transition hover:bg-white/5 hover:text-foreground sm:size-auto sm:px-3 sm:py-2"
              href="/design"
            >
              <ImageUp size={17} />
              <span className="hidden sm:ml-2 sm:inline">Design</span>
            </Link>
            <Link
              aria-label="Orders"
              className="focus-ring inline-flex size-10 items-center justify-center rounded-lg text-muted transition hover:bg-white/5 hover:text-foreground sm:size-auto sm:px-3 sm:py-2"
              href="/orders"
            >
              <Package size={17} />
              <span className="hidden sm:ml-2 sm:inline">Orders</span>
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
                  aria-label="Profile"
                  className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white/5 px-2 text-foreground"
                  href="/profile"
                >
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      className="size-7 rounded object-cover"
                      src={avatarUrl}
                    />
                  ) : (
                    <UserRound size={18} />
                  )}
                  {nickname ? (
                    <span className="hidden max-w-24 truncate sm:inline">{nickname}</span>
                  ) : null}
                </Link>
                <SignOutButton />
              </>
            ) : (
              <>
                <Link
                  aria-label="Profile"
                  className="focus-ring hidden size-10 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-foreground sm:inline-flex"
                  href="/profile"
                >
                  <UserRound size={18} />
                </Link>
                <Link
                  className="focus-ring rounded-lg bg-accent px-4 py-2 font-bold text-accent-ink transition hover:bg-foreground active:translate-y-px"
                  href="/auth"
                >
                  Sign in
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
