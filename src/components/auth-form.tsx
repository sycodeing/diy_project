"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Mail, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function AuthForm({
  initialMessage,
  nextPath,
}: {
  initialMessage?: string | null;
  nextPath: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [message, setMessage] = useState<string | null>(initialMessage ?? null);
  const [isPending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();

      if (!supabase) {
        setMessage("Missing Supabase environment variables.");
        return;
      }

      const email = String(formData.get("email") ?? "");
      const password = String(formData.get("password") ?? "");
      const callbackOrigin =
        process.env.NEXT_PUBLIC_AUTH_REDIRECT_URL?.trim() || window.location.origin;
      let callbackUrl: string;
      try {
        const callback = new URL("/auth/callback", callbackOrigin);
        callback.searchParams.set("next", nextPath);
        callbackUrl = callback.toString();
      } catch {
        setMessage("The email confirmation address is not configured correctly.");
        return;
      }

      if (
        mode === "sign-up" &&
        ["localhost", "127.0.0.1", "::1"].includes(new URL(callbackUrl).hostname) &&
        !process.env.NEXT_PUBLIC_AUTH_REDIRECT_URL
      ) {
        setMessage(
          "Open the hosted Preview website before creating an account. A localhost confirmation link cannot be opened from another device.",
        );
        return;
      }

      const result =
        mode === "sign-up"
          ? await supabase.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: callbackUrl },
            })
          : await supabase.auth.signInWithPassword({ email, password });

      if (result.error) {
        setMessage(result.error.message);
        return;
      }

      if (mode === "sign-up" && !result.data.session) {
        setMessage("Check your email to confirm the account, then sign in.");
        return;
      }

      router.push(nextPath || "/");
      router.refresh();
    });
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-5 shadow-[0_18px_48px_rgba(23,33,31,0.1)]">
      <div className="mb-6 flex rounded-lg border border-line bg-surface p-1">
        {(["sign-in", "sign-up"] as const).map((item) => (
          <button
            className={`focus-ring flex-1 rounded-md px-3 py-2 text-sm font-bold transition ${
              mode === item
                ? "bg-panel text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
            key={item}
            onClick={() => {
              setMode(item);
              setMessage(null);
            }}
            type="button"
          >
            {item === "sign-in" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form action={submit} className="space-y-4">
        <label className="block">
          <span className="mb-2 flex items-center gap-2 text-sm font-bold text-muted">
            <Mail size={15} />
            Email
          </span>
          <input
            className="focus-ring h-12 w-full rounded-lg border border-line bg-panel px-3 text-foreground placeholder:text-muted"
            name="email"
            placeholder="you@example.com"
            required
            type="email"
          />
        </label>
        <label className="block">
          <span className="mb-2 flex items-center gap-2 text-sm font-bold text-muted">
            <LockKeyhole size={15} />
            Password
          </span>
          <input
            className="focus-ring h-12 w-full rounded-lg border border-line bg-panel px-3 text-foreground placeholder:text-muted"
            minLength={6}
            name="password"
            placeholder="At least 6 characters"
            required
            type="password"
          />
        </label>

        <p className="text-xs leading-5 text-muted">
          登录状态会保存在此设备，最长 7 天；在公用设备上请记得退出登录。
        </p>

        {message ? (
          <p className="rounded-lg border border-accent/20 bg-accent-soft p-3 text-sm text-accent-strong">
            {message}
          </p>
        ) : null}

        <button
          className="focus-ring inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 font-black text-accent-ink transition hover:bg-accent-strong active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending
            ? "Working..."
            : mode === "sign-in"
              ? "Enter studio"
              : "Create account"}
          <ArrowRight size={18} />
        </button>
      </form>
    </div>
  );
}
