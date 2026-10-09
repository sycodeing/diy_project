import type { Metadata } from "next";
import { Mail, MessageCircle } from "lucide-react";
import { PolicyPage, PolicySection } from "@/components/policy-page";
import { getSupportContacts } from "@/lib/public-site";

export const metadata: Metadata = {
  title: "Contact | Studio Blank",
  description: "Contact Studio Blank about an order, payment, design file, or delivery.",
};

export default function ContactPage() {
  const { email, telegramUrl } = getSupportContacts();

  return (
    <PolicyPage
      currentPath="/contact"
      intro="Contact our support desk about an order, payment, design file, or delivery."
      title="Contact us"
    >
      <PolicySection title="Customer support">
        <p>
          We reply Monday through Friday, 9:00 AM to 6:00 PM China Standard
          Time. Most messages receive a response within 1-2 business days.
        </p>
        <div className="grid gap-3 pt-2 sm:grid-cols-2">
          {email ? (
            <a
              className="focus-ring flex min-h-24 items-center gap-3 rounded-xl border border-line bg-panel p-4 font-bold text-foreground shadow-sm transition hover:bg-surface"
              href={`mailto:${email}`}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                <Mail aria-hidden="true" size={19} />
              </span>
              <span className="min-w-0 break-all">{email}</span>
            </a>
          ) : (
            <div className="rounded-xl border border-danger/25 bg-danger-soft p-4 text-foreground sm:col-span-2">
              <p className="font-bold">Support email is not configured yet.</p>
              <p className="mt-1 text-sm leading-6 text-muted">
                The store owner must set NEXT_PUBLIC_SUPPORT_EMAIL before live
                payments are accepted.
              </p>
            </div>
          )}

          {telegramUrl ? (
            <a
              className="focus-ring flex min-h-24 items-center gap-3 rounded-xl border border-line bg-panel p-4 font-bold text-foreground shadow-sm transition hover:bg-surface"
              href={telegramUrl}
              rel="noreferrer"
              target="_blank"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                <MessageCircle aria-hidden="true" size={19} />
              </span>
              Telegram support
            </a>
          ) : null}
        </div>
      </PolicySection>

      <PolicySection title="What to include">
        <p>
          Include your order number, checkout email, and a clear description of
          the issue. For a damaged or incorrect item, attach photos of the item,
          packaging, and shipping label.
        </p>
        <p>
          Do not post your home address, phone number, card details, or payment
          credentials in a public Telegram channel.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
