"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  const router = useRouter();

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase?.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <button
      aria-label={label}
      className="focus-ring inline-flex size-11 items-center justify-center gap-2 rounded-lg border border-line bg-panel text-sm text-muted transition hover:bg-surface hover:text-foreground active:translate-y-px sm:size-auto sm:min-h-11 sm:px-3 sm:py-2"
      onClick={signOut}
      type="button"
    >
      <LogOut size={15} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
