import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  await requireAdmin("/admin/orders");
  redirect("/admin/orders");
}
