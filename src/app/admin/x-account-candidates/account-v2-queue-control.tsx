import { ManualAdd } from "@/app/admin/x-account-manual-posts/controls";
/** Keep the card import stable while routing new work to manual-only storage. */
export function AccountV2QueueControl({ authorId, hasPreview = true }: {
  authorId: string; hasPreview?: boolean;
  senders: Array<{ id: string; label: string }>;
  automaticPreviewBlockReason?: string | null;
  automaticPreviewFallback?: boolean;
  savedFallbackPreview?: boolean;
}) {
  return <ManualAdd authorId={authorId} hasPreview={hasPreview} />;
}
