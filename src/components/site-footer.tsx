import Link from "next/link";
import { Mail } from "lucide-react";
import { getSupportContacts, STORE_NAME } from "@/lib/public-site";

const policyLinks = [
  { href: "/contact", label: "Contact" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/returns", label: "Returns" },
  { href: "/shipping", label: "Shipping" },
] as const;

export function SiteFooter() {
  const { email } = getSupportContacts();

  return (
    <footer className="mt-auto border-t border-line bg-panel">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="text-sm font-black tracking-[-0.01em]">{STORE_NAME}</p>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted">
            Custom pillow covers made from your image and shipped with tracking.
          </p>
          {email ? (
            <a
              className="focus-ring mt-4 inline-flex items-center gap-2 rounded-lg text-sm font-bold text-accent hover:text-accent-strong"
              href={`mailto:${email}`}
            >
              <Mail aria-hidden="true" size={16} />
              {email}
            </a>
          ) : null}
        </div>

        <nav aria-label="Store policies" className="flex flex-wrap gap-x-5 gap-y-3 text-sm">
          {policyLinks.map((link) => (
            <Link
              className="focus-ring rounded text-muted transition hover:text-foreground"
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
