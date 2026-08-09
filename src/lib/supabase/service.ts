import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceConfig } from "@/lib/env";

let serviceClient: SupabaseClient | null = null;

export function getSupabaseServiceClient() {
  const config = getSupabaseServiceConfig();

  if (!config) {
    return null;
  }

  if (!serviceClient) {
    serviceClient = createClient(config.url, config.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return serviceClient;
}

