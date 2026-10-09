"use client";

import { ChangeEvent, useEffect, useState, useTransition } from "react";
import { ImageUp, Save, UserRound } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const LOCAL_PROFILE_KEY = "studio-blank-profile";

type LocalProfile = {
  avatarUrl: string | null;
  nickname: string;
};

export function ProfileForm({
  authEnabled,
  email,
  initialAvatarUrl,
  initialNickname,
  userId,
}: {
  authEnabled: boolean;
  email: string | null;
  initialAvatarUrl: string | null;
  initialNickname: string;
  userId: string | null;
}) {
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [nickname, setNickname] = useState(initialNickname);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (authEnabled) return;

    queueMicrotask(() => {
      try {
        const saved = JSON.parse(
          window.localStorage.getItem(LOCAL_PROFILE_KEY) ?? "null",
        ) as LocalProfile | null;
        if (saved) {
          setAvatarUrl(saved.avatarUrl);
          setNickname(saved.nickname);
        }
      } catch {
        window.localStorage.removeItem(LOCAL_PROFILE_KEY);
      }
    });
  }, [authEnabled]);

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 1_500_000) {
      setMessage("Choose a JPG, PNG or WebP image smaller than 1.5 MB.");
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        setAvatarUrl(reader.result);
        setAvatarFile(file);
        setMessage(null);
      }
    });
    reader.readAsDataURL(file);
  }

  function saveProfile() {
    startTransition(async () => {
      const cleanNickname = nickname.trim();

      if (!cleanNickname) {
        setMessage("Enter a nickname.");
        return;
      }

      if (!authEnabled) {
        window.localStorage.setItem(
          LOCAL_PROFILE_KEY,
          JSON.stringify({ avatarUrl, nickname: cleanNickname }),
        );
        setMessage("Local debug profile saved.");
        return;
      }

      const supabase = createSupabaseBrowserClient();

      if (!supabase || !userId) {
        setMessage("Sign in again before saving your profile.");
        return;
      }

      let nextAvatarUrl = avatarUrl;

      if (avatarFile) {
        const extension = avatarFile.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${userId}/avatar.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, { cacheControl: "3600", upsert: true });

        if (uploadError) {
          setMessage(uploadError.message);
          return;
        }

        const { data } = supabase.storage.from("avatars").getPublicUrl(path);
        nextAvatarUrl = `${data.publicUrl}?v=${Date.now()}`;
      }

      const { error } = await supabase.auth.updateUser({
        data: {
          avatar_url: nextAvatarUrl,
          display_name: cleanNickname,
        },
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      setAvatarUrl(nextAvatarUrl);
      setAvatarFile(null);
      setMessage("Profile saved.");
      window.location.reload();
    });
  }

  return (
    <section className="w-full max-w-2xl border-t border-line pt-6">
      <div className="grid gap-8 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div>
          <div className="grid aspect-square place-items-center overflow-hidden rounded-lg border border-line bg-surface">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="Profile avatar" className="h-full w-full object-cover" src={avatarUrl} />
            ) : (
              <UserRound className="text-muted" size={52} />
            )}
          </div>
          <label className="focus-ring mt-3 inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-panel text-sm font-bold hover:bg-surface">
            <ImageUp size={16} /> Change avatar
            <input
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={chooseAvatar}
              type="file"
            />
          </label>
        </div>

        <div className="space-y-5">
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-muted">Nickname</span>
            <input
              className="focus-ring h-12 w-full rounded-lg border border-line bg-panel px-3 text-foreground"
              maxLength={40}
              onChange={(event) => setNickname(event.target.value)}
              value={nickname}
            />
          </label>
          <div>
            <p className="text-sm font-bold text-muted">Email</p>
            <p className="mt-2 text-foreground">
              {email ?? (authEnabled ? "Not available" : "Local debug profile")}
            </p>
          </div>

          {!authEnabled ? (
            <p className="text-sm leading-6 text-muted">
              Supabase is not configured, so this profile is stored only in this
              browser for UI testing.
            </p>
          ) : null}

          {message ? (
            <p className="rounded-lg border border-accent/20 bg-accent-soft p-3 text-sm text-accent-strong">
              {message}
            </p>
          ) : null}

          <button
            className="focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-accent px-5 font-black text-accent-ink hover:bg-foreground disabled:opacity-60"
            disabled={isPending}
            onClick={saveProfile}
            type="button"
          >
            <Save size={17} /> {isPending ? "Saving..." : "Save profile"}
          </button>
        </div>
      </div>
    </section>
  );
}
