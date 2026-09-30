export function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
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

  return {
    secretKey:
      secretKey && !secretKey.includes("your-key") ? secretKey : undefined,
    webhookSecret:
      webhookSecret && !webhookSecret.includes("your-secret")
        ? webhookSecret
        : undefined,
  };
}

export function getTemuSyncSecret() {
  const secret = process.env.TEMU_SYNC_SECRET;

  return secret && !secret.includes("your-") ? secret : undefined;
}

export function getMarketingIngestSecret() {
  const secret = process.env.MARKETING_INGEST_SECRET?.trim();
  return secret && secret.length >= 32 && !secret.startsWith("your-") ? secret : undefined;
}
