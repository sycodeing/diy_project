import Link from "next/link";
import { ImageUp, Package, Shield, UserRound } from "lucide-react";
import { getCurrentUser, getIsAdmin } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { AdminNavigation } from "@/components/admin-navigation";
import { SiteFooter } from "@/components/site-footer";

export async function AppShell({
  children,
  admin = false,
}: {
  children: React.ReactNode;
  admin?: boolean;
}) {
  const user = await getCurrentUser();
  const isAdmin = await getIsAdmin();
  const avatarUrl = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture;
  const nickname =
    user?.user_metadata?.display_name ??
    user?.user_metadata?.full_name ??
    user?.user_metadata?.name;

  return (
    <div
      className={`${admin ? "admin-theme " : ""}grain flex min-h-[100dvh] flex-col bg-background text-foreground`}
    >
      <header className="sticky top-0 z-40 border-b border-line bg-panel/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span
              className={`flex size-9 items-center justify-center rounded-xl bg-accent text-accent-ink shadow-sm ${admin ? "shadow-blue-900/15" : "shadow-teal-900/15"}`}
            >
              <Package size={18} strokeWidth={2} />
            </span>
            <span className="leading-none">
              <span className="block whitespace-nowrap text-xs font-black uppercase tracking-[0.14em] sm:text-sm sm:tracking-[0.18em]">
                Studio Blank
              </span>
              <span className="hidden text-xs text-muted sm:block">
                {admin ? "管理后台" : "Custom pillow studio"}
              </span>
            </span>
          </Link>

          <nav className="flex shrink-0 items-center gap-1 text-sm sm:gap-2">
            {!admin ? (
              <>
                <Link
                  aria-label="Design"
                  className="focus-ring inline-flex size-10 items-center justify-center rounded-lg text-muted transition hover:bg-surface hover:text-foreground sm:size-auto sm:px-3 sm:py-2"
                  href="/products"
                >
                  <ImageUp size={17} />
                  <span className="hidden sm:ml-2 sm:inline">Create</span>
                </Link>
                <Link
                  aria-label="Orders"
                  className="focus-ring inline-flex size-10 items-center justify-center rounded-lg text-muted transition hover:bg-surface hover:text-foreground sm:size-auto sm:px-3 sm:py-2"
                  href="/orders"
                >
                  <Package size={17} />
                  <span className="hidden sm:ml-2 sm:inline">Orders</span>
                </Link>
              </>
            ) : null}
            {!admin && isAdmin ? (
              <Link
                className="focus-ring hidden items-center gap-2 rounded-lg px-3 py-2 text-muted transition hover:bg-surface hover:text-foreground sm:inline-flex"
                href="/admin/orders"
              >
                <Shield size={15} />
                  <span className="hidden sm:inline">管理后台</span>
              </Link>
            ) : null}
            {admin && isAdmin ? <AdminNavigation /> : null}
            {user ? (
              <>
                <Link
                  aria-label={admin ? "个人中心" : "Profile"}
                  className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-panel px-2 text-foreground shadow-sm"
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
                <SignOutButton label={admin ? "退出登录" : "Sign out"} />
              </>
            ) : (
              <>
                <Link
                  aria-label="Profile"
                  className="focus-ring hidden size-10 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-foreground sm:inline-flex"
                  href="/profile"
                >
                  <UserRound size={18} />
                </Link>
                <Link
                  className="focus-ring whitespace-nowrap rounded-lg bg-accent px-3 py-2 font-bold text-accent-ink shadow-sm shadow-teal-900/15 transition hover:bg-accent-strong active:translate-y-px sm:px-4"
                  href="/auth"
                >
                  Sign in
                </Link>
              </>
            )}
          </nav>
        </div>
        {admin && isAdmin ? <AdminNavigation mobile /> : null}
      </header>
      {children}
      {!admin ? <SiteFooter /> : null}
    </div>
  );
}
