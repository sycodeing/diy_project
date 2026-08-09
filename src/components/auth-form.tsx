"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Mail, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function AuthForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [message, setMessage] = useState<string | null>(null);
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

      const result =
        mode === "sign-up"
          ? await supabase.auth.signUp({ email, password })
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
    <div className="w-full max-w-md rounded-lg border border-line bg-panel/88 p-5 shadow-2xl shadow-black/40">
      <div className="mb-6 flex rounded-lg border border-line bg-black p-1">
        {(["sign-in", "sign-up"] as const).map((item) => (
          <button
            className={`focus-ring flex-1 rounded-md px-3 py-2 text-sm font-bold transition ${
              mode === item
                ? "bg-foreground text-background"
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
            className="focus-ring h-12 w-full rounded-lg border border-line bg-black px-3 text-foreground placeholder:text-stone-600"
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
            className="focus-ring h-12 w-full rounded-lg border border-line bg-black px-3 text-foreground placeholder:text-stone-600"
            minLength={6}
            name="password"
            placeholder="At least 6 characters"
            required
            type="password"
          />
        </label>

        {message ? (
          <p className="rounded-lg border border-line bg-black p-3 text-sm text-accent">
            {message}
          </p>
        ) : null}

        <button
          className="focus-ring inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 font-black text-accent-ink transition hover:bg-foreground active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
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

