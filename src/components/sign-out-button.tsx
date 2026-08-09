"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase?.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <button
      className="focus-ring inline-flex items-center gap-2 rounded-lg border border-line bg-white/5 px-3 py-2 text-sm text-muted transition hover:bg-white/10 hover:text-foreground active:translate-y-px"
      onClick={signOut}
      type="button"
    >
      <LogOut size={15} />
      <span className="hidden sm:inline">Sign out</span>
    </button>
  );
}

