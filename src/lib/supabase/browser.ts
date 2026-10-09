"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseBrowserConfig } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

export function createSupabaseBrowserClient() {
  const config = getSupabaseBrowserConfig();

  if (!config) {
    return null;
  }

  return createBrowserClient(config.url, config.anonKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
  });
}
