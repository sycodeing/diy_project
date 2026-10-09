import type { CookieOptions } from "@supabase/ssr";

/** Keep Supabase sessions in this browser for up to 7 days. */
export const AUTH_COOKIE_OPTIONS: CookieOptions = {
  path: "/",
  sameSite: "lax",
  httpOnly: false,
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60,
};
