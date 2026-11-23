import { AppShell } from "@/components/app-shell";
import { SetupWarning } from "@/components/setup-warning";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AccountReviewPage, type AccountCandidateFilters } from "./account-review-page";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function AccountCandidatesPage({ searchParams }: {
  searchParams: Promise<AccountCandidateFilters>;
}) {
  const filters = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  await requireAdmin(`/admin/x-account-candidates${params.size ? `?${params}` : ""}`);
  if (!getSupabaseServiceClient()) {
    return <AppShell admin><main className="mx-auto w-full max-w-3xl px-4 py-10"><SetupWarning /></main></AppShell>;
  }
  return <AccountReviewPage filters={filters} />;
}
