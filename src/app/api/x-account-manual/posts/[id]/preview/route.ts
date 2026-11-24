import { requireAdmin } from "@/lib/auth";
import { ACCOUNT_MANUAL_PATH, MANUAL_SENDER_ID, type ManualSnapshot } from "@/lib/x-account-manual";
import { manualDb } from "@/lib/x-account-manual-server";
import { signAccountDesignAsset } from "@/lib/x-account-design-assets";
import { createHash } from "node:crypto";
import sharp from "sharp";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await requireAdmin(ACCOUNT_MANUAL_PATH);
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Invalid task", { status: 400 });
  const { data: task } = await manualDb().from("x_account_manual_posts").select("snapshot")
    .eq("id", id).eq("account_id", MANUAL_SENDER_ID).in("status", ["draft", "reported"]).maybeSingle();
  const snapshot = task?.snapshot as ManualSnapshot | undefined;
  if (!snapshot?.account_preview_path || !snapshot.account_preview_hash) return new Response("No reviewed preview", { status: 404 });
  const url = await signAccountDesignAsset(snapshot.account_preview_path, 60);
  if (!url) return new Response("Preview unavailable", { status: 503 });
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!response.ok) return new Response("Preview unavailable", { status: 503 });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== snapshot.account_preview_hash) return new Response("Preview hash mismatch", { status: 409 });
  const png = await sharp(bytes).png().toBuffer();
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="reviewed-preview-${id}.png"`, "Cache-Control": "private, no-store" } });
}
