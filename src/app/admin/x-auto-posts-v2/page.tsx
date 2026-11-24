import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";
/** Compatibility URL only; no automatic controls remain. */
export default async function FormerV2Page() {
  await requireAdmin("/admin/x-auto-posts-v2");
  redirect("/admin/x-account-manual-posts");
}
