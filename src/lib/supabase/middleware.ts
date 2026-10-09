import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseBrowserConfig } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

export async function updateSession(request: NextRequest) {
  const config = getSupabaseBrowserConfig();
  let response = NextResponse.next({ request });

  if (!config) {
    return response;
  }

  const supabase = createServerClient(config.url, config.anonKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}
