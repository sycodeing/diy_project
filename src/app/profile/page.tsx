import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ProfileForm } from "@/components/profile-form";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseBrowserConfig } from "@/lib/env";

export default async function ProfilePage() {
  const authEnabled = Boolean(getSupabaseBrowserConfig());
  const user = await getCurrentUser();

  if (authEnabled && !user) {
    redirect("/auth?next=/profile");
  }

  const metadata = user?.user_metadata ?? {};
  const nickname = String(
    metadata.display_name ?? metadata.full_name ?? metadata.name ?? "",
  );
  const avatarUrl = metadata.avatar_url ?? metadata.picture ?? null;

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">
          Your account
        </p>
        <h1 className="mt-3 text-5xl font-black tracking-normal">Profile</h1>
        <p className="mb-8 mt-4 max-w-2xl leading-7 text-muted">
          Keep the name and avatar attached to your theBestDiy account.
        </p>
        <ProfileForm
          authEnabled={authEnabled}
          email={user?.email ?? null}
          initialAvatarUrl={avatarUrl}
          initialNickname={nickname}
          userId={user?.id ?? null}
        />
      </main>
    </AppShell>
  );
}
