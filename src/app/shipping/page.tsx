import type { Metadata } from "next";
import {
  PolicyList,
  PolicyPage,
  PolicySection,
} from "@/components/policy-page";

export const metadata: Metadata = {
  title: "Shipping and Delivery | theBestDiy",
  description: "Production, tracking, and estimated U.S. delivery times for theBestDiy orders.",
};

export default function ShippingPage() {
  return (
    <PolicyPage
      currentPath="/shipping"
      intro="Production usually takes 1 business day. U.S. delivery is expected within 10-20 business days after dispatch."
      title="Shipping and delivery"
    >
      <PolicySection title="Production time">
        <p>
          We usually complete production and shipping preparation within 1
          business day after payment is confirmed and a valid customization file
          has been received.
        </p>
      </PolicySection>

      <PolicySection title="Estimated U.S. delivery">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
            <p className="text-sm font-bold text-muted">After dispatch</p>
            <p className="mt-1 text-2xl font-black text-foreground">10-20 business days</p>
          </div>
          <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
            <p className="text-sm font-bold text-muted">Payment to delivery</p>
            <p className="mt-1 text-2xl font-black text-foreground">11-21 business days</p>
          </div>
        </div>
        <p>
          Most customers should plan for approximately 2-4 weeks from payment to
          delivery. These are estimates, not guaranteed delivery dates. Business
          days exclude weekends and public holidays.
        </p>
      </PolicySection>

      <PolicySection title="Tracking">
        <p>
          We provide tracking when a valid carrier number becomes available. The
          first tracking update may take 1-3 business days after dispatch.
        </p>
      </PolicySection>

      <PolicySection title="Possible delays">
        <p>The following conditions may add 5-10 business days or more:</p>
        <PolicyList>
          <li>Delivery to Alaska, Hawaii, or remote areas.</li>
          <li>Customs review or carrier inspection.</li>
          <li>Incomplete address or phone information.</li>
          <li>Severe weather, flight disruption, or carrier congestion.</li>
          <li>Peak periods such as Black Friday, Christmas, or Lunar New Year.</li>
        </PolicyList>
      </PolicySection>

      <PolicySection title="Address changes and missing parcels">
        <p>
          Contact support immediately if an address is wrong. We cannot guarantee
          a change after production or shipping begins. If tracking exceeds the
          estimated delivery period, contact us so we can investigate. A parcel
          confirmed lost by the carrier will be replaced or refunded.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
