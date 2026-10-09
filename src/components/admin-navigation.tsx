"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin/orders", label: "订单管理", matches: ["/admin/orders"] },
  { href: "/admin/temu-purchases", label: "人工下单", matches: ["/admin/temu-purchases"] },
  { href: "/admin/marketing", label: "营销数据", matches: ["/admin/marketing"] },
];

export function AdminNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  if (mobile) {
    return (
      <div className="border-t border-line bg-panel px-4 sm:hidden">
        <nav aria-label="后台导航" className="flex min-w-0 gap-1 overflow-x-auto py-2">
          {links.map((link) => {
            const active = link.matches.some((path) => pathname.startsWith(path));
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`focus-ring shrink-0 rounded-lg px-3 py-2 text-sm font-bold ${active ? "bg-accent-soft text-accent-strong" : "text-muted hover:bg-surface hover:text-foreground"}`}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <div className="hidden items-center gap-1 sm:flex">
      <nav aria-label="后台导航" className="flex items-center gap-1">
        {links.map((link) => {
          const active = link.matches.some((path) => pathname.startsWith(path));
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`focus-ring rounded-lg px-3 py-2 font-bold ${active ? "bg-accent-soft text-accent-strong" : "text-muted hover:bg-surface hover:text-foreground"}`}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
