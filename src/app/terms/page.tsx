import type { Metadata } from "next";
import {
  PolicyList,
  PolicyPage,
  PolicySection,
} from "@/components/policy-page";

export const metadata: Metadata = {
  title: "Terms and Conditions | theBestDiy",
  description: "Terms for purchasing from and using theBestDiy.",
};

export default function TermsPage() {
  return (
    <PolicyPage
      currentPath="/terms"
      intro="These terms apply when you use theBestDiy, upload a design, or place an order."
      title="Terms and conditions"
    >
      <PolicySection title="Using the store">
        <p>
          You must be at least 18 years old, or use the store with the involvement
          of a parent or legal guardian. You must provide accurate account,
          payment, and delivery information.
        </p>
      </PolicySection>

      <PolicySection title="Your custom content">
        <p>You confirm that every image, name, phrase, or design you upload:</p>
        <PolicyList>
          <li>belongs to you or is used with valid permission;</li>
          <li>does not infringe copyright, trademark, privacy, or publicity rights;</li>
          <li>does not contain unlawful, hateful, deceptive, or abusive material.</li>
        </PolicyList>
        <p>
          You give us a limited permission to use the submitted content only as
          needed to preview, produce, deliver, and support your order. We may
          reject content that appears unlawful, infringing, or unsuitable for
          production.
        </p>
      </PolicySection>

      <PolicySection title="Orders and payment">
        <p>
          Prices are displayed in U.S. dollars unless the checkout states
          otherwise. An order is accepted only after the payment provider confirms
          successful payment. We may cancel and refund an order if a product is
          unavailable, a payment is reversed, or the submitted content cannot be
          produced.
        </p>
        <p>
          Any shipping charge or tax collected by theBestDiy will be shown
          before payment. A government, customs authority, or carrier may impose
          charges outside our control.
        </p>
      </PolicySection>

      <PolicySection title="Preview and production differences">
        <p>
          Screen settings, fabric texture, printing, cropping, and lighting may
          produce small differences between a digital preview and the finished
          item. Minor color or placement differences within normal production
          tolerances are not defects.
        </p>
      </PolicySection>

      <PolicySection title="Delivery and customer responsibility">
        <p>
          You are responsible for checking the recipient name, phone number,
          street address, city, state, and postal code before payment. If you find
          an error, contact support immediately. Changes may not be possible after
          production or shipping begins.
        </p>
      </PolicySection>

      <PolicySection title="Consumer rights">
        <p>
          These terms do not remove rights that cannot legally be excluded. Our
          returns and shipping policies form part of these terms. If a translated
          version conflicts with the English version, the English version controls
          unless applicable law requires otherwise.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
