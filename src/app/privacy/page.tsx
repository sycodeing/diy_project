import type { Metadata } from "next";
import {
  PolicyList,
  PolicyPage,
  PolicySection,
} from "@/components/policy-page";

export const metadata: Metadata = {
  title: "Privacy Policy | Studio Blank",
  description: "How Studio Blank collects, uses, and shares customer information.",
};

export default function PrivacyPage() {
  return (
    <PolicyPage
      currentPath="/privacy"
      intro="This policy explains what information we collect and how we use it to create, pay for, and deliver your custom order."
      title="Privacy policy"
    >
      <PolicySection title="Information we collect">
        <PolicyList>
          <li>Account details, including your email address.</li>
          <li>Order details, product choices, and order status.</li>
          <li>Your recipient name, phone number, and shipping address.</li>
          <li>Images, text, and other customization files you upload.</li>
          <li>Payment status and payment processor transaction identifiers.</li>
          <li>Device, cookie, site activity, and marketing attribution data.</li>
        </PolicyList>
        <p>
          PayPal and other payment providers process your payment details. We do
          not store your full card number or card security code.
        </p>
      </PolicySection>

      <PolicySection title="How we use information">
        <PolicyList>
          <li>Create, manage, and deliver your order.</li>
          <li>Prepare your custom artwork and production files.</li>
          <li>Confirm payment status and prevent fraud or abuse.</li>
          <li>Provide order updates and customer support.</li>
          <li>Measure and improve our store and checkout experience.</li>
          <li>Comply with accounting, legal, and dispute requirements.</li>
        </PolicyList>
      </PolicySection>

      <PolicySection title="Who receives information">
        <p>
          We share only the information reasonably needed to complete a service.
          Recipients may include payment providers, website hosting and database
          providers, Temu or another production supplier, and shipping carriers.
        </p>
        <p>
          We may also disclose information when required by law, a valid legal
          request, or the need to protect customers, our store, or the public.
        </p>
      </PolicySection>

      <PolicySection title="International processing and retention">
        <p>
          Our customers, service providers, production partners, and carriers may
          be located in different countries. Your information may therefore be
          processed outside your country of residence.
        </p>
        <p>
          We keep information only as long as reasonably needed to fulfill orders,
          provide support, prevent fraud, resolve disputes, and meet legal or
          accounting obligations.
        </p>
      </PolicySection>

      <PolicySection title="Your choices">
        <p>
          You may ask to access, correct, or delete your personal information by
          contacting support. Some records may need to be retained for payment,
          fraud prevention, tax, legal, or dispute purposes.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
