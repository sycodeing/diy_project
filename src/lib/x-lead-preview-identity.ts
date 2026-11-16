import { createHmac } from "node:crypto";

// Bind the cached mockup to the chosen attachment. A different photo in the
// same post must never reuse an earlier photo's generated pillow preview.
export function getXLeadPreviewSourceHash(secret: string, postId: string, mediaUrl: string) {
  return createHmac("sha256", secret).update(`x-post-photo-v2:${postId}\n${mediaUrl}`).digest("hex");
}
