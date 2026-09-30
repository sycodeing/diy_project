import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function requireUser(next = "/") {
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/auth?next=${encodeURIComponent(next)}`);
  }

  return user;
}

export async function getIsAdmin() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return false;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  const { data } = await supabase
    .from("admin_roles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  return Boolean(data);
}

export async function requireAdmin(next = "/admin/orders") {
  const user = await requireUser(next);
  const isAdmin = await getIsAdmin();

  if (!isAdmin) {
    redirect("/orders");
  }

  return user;
}
