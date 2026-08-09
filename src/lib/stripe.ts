import Stripe from "stripe";
import { getStripeConfig } from "@/lib/env";

let stripeClient: Stripe | null = null;

export function getStripeClient() {
  const { secretKey } = getStripeConfig();

  if (!secretKey) {
    return null;
  }

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey, {
      typescript: true,
    });
  }

  return stripeClient;
}

