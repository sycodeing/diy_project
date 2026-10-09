export function getAppUrl(requestUrl?: string) {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const isLocalUrl = (value: string) => {
    try {
      return ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
    } catch {
      return true;
    }
  };

  // Vercel preview URLs must follow the deployment that initiated checkout;
  // a local .env value must never send a remote buyer back to their own device.
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  if (configuredUrl && !isLocalUrl(configuredUrl)) return configuredUrl;

  if (requestUrl) {
    try {
      return new URL(requestUrl).origin;
    } catch {
      // Fall through to the configured development default.
    }
  }

  if (configuredUrl) return configuredUrl;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function getSupabaseBrowserConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey || url.includes("your-project-ref")) {
    return null;
  }

  return { url, anonKey };
}

export function getSupabaseServiceConfig() {
  const browser = getSupabaseBrowserConfig();
  const serviceRoleKey =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!browser || !serviceRoleKey || serviceRoleKey.includes("your-")) {
    return null;
  }

  return { ...browser, serviceRoleKey };
}

export function getStripeConfig() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const automaticTaxEnabled =
    process.env.STRIPE_AUTOMATIC_TAX_ENABLED?.trim().toLowerCase() === "true";

  return {
    secretKey:
      secretKey && !secretKey.includes("your-key") ? secretKey : undefined,
    webhookSecret:
      webhookSecret && !webhookSecret.includes("your-secret")
        ? webhookSecret
        : undefined,
    automaticTaxEnabled,
  };
}

export function getPayPalConfig() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  const environment = process.env.PAYPAL_ENVIRONMENT?.trim().toLowerCase();

  return {
    clientId:
      clientId && !clientId.startsWith("your-") ? clientId : undefined,
    clientSecret:
      clientSecret && !clientSecret.startsWith("your-")
        ? clientSecret
        : undefined,
    webhookId:
      webhookId && !webhookId.startsWith("your-") ? webhookId : undefined,
    environment: environment === "live" ? "live" : "sandbox",
  } as const;
}

export function getTemuSyncSecret() {
  const secret = process.env.TEMU_SYNC_SECRET;

  return secret && !secret.includes("your-") ? secret : undefined;
}

export function getMarketingIngestSecret() {
  const secret = process.env.MARKETING_INGEST_SECRET?.trim();
  return secret && secret.length >= 32 && !secret.startsWith("your-") ? secret : undefined;
}
