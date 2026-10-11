import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { PolicyPage, PolicySection } from "@/components/policy-page";
import { SUPPORT_EMAIL } from "@/lib/public-site";

export const metadata: Metadata = {
  title: "Contact | theBestDiy",
  description: "Contact theBestDiy about an order, payment, design file, or delivery.",
};

export default function ContactPage() {
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
        <div className="pt-2">
          <a
            className="focus-ring flex min-h-24 max-w-xl items-center gap-3 rounded-xl border border-line bg-panel p-4 font-bold text-foreground shadow-sm transition hover:bg-surface"
            href={`mailto:${SUPPORT_EMAIL}`}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <Mail aria-hidden="true" size={19} />
            </span>
            <span className="min-w-0 break-all">{SUPPORT_EMAIL}</span>
          </a>
        </div>
      </PolicySection>

      <PolicySection title="What to include">
        <p>
          Include your order number, checkout email, and a clear description of
          the issue. For a damaged or incorrect item, attach photos of the item,
          packaging, and shipping label.
        </p>
        <p>
          Never include card details, passwords, or payment credentials in your
          support email.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
