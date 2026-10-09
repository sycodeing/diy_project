import type { Metadata } from "next";
import {
  PolicyList,
  PolicyPage,
  PolicySection,
} from "@/components/policy-page";

export const metadata: Metadata = {
  title: "Returns and Refunds | Studio Blank",
  description: "Cancellation, replacement, and refund terms for custom Studio Blank products.",
};

export default function ReturnsPage() {
  return (
    <PolicyPage
      currentPath="/returns"
      intro="Every item is made from the image and options submitted for one customer."
      title="Returns and refunds"
    >
      <PolicySection title="Personalized items">
        <p>
          Custom-made products cannot be returned or exchanged because you changed
          your mind, no longer want the item, or selected the wrong image or
          option. This does not limit rights that cannot legally be excluded.
        </p>
      </PolicySection>

      <PolicySection title="Cancellation window">
        <p>
          You may request cancellation within 2 hours after payment, provided
          production has not started. Once production begins, the order cannot be
          canceled or changed.
        </p>
      </PolicySection>

      <PolicySection title="Problems we will resolve">
        <PolicyList>
          <li>You receive the wrong product.</li>
          <li>The item arrives with clear shipping damage.</li>
          <li>The item has a serious manufacturing defect.</li>
          <li>The finished item clearly differs from the confirmed design or size.</li>
          <li>The carrier confirms that the parcel is lost.</li>
        </PolicyList>
        <p>
          Contact us within 7 days after delivery. Include the order number and
          clear photos of the item, packaging, and shipping label. After review,
          we will provide a replacement, remake, or refund as appropriate.
        </p>
      </PolicySection>

      <PolicySection title="What is not a defect">
        <PolicyList>
          <li>Small color differences between a screen and printed fabric.</li>
          <li>Minor placement differences within normal production tolerances.</li>
          <li>Blur, artifacts, or low resolution already present in the uploaded image.</li>
          <li>An item that matches the preview and options confirmed at checkout.</li>
          <li>Delivery failure caused by an incorrect or incomplete customer address.</li>
        </PolicyList>
        <p>Do not send an item back unless support provides return instructions.</p>
      </PolicySection>

      <PolicySection title="Refund destination">
        <p>
          Approved refunds are returned to the original payment method. The time
          required for funds to appear depends on PayPal, the card issuer, and the
          buyer&apos;s bank.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
