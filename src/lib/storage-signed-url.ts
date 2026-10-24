type SignedUrlResult = {
  data: { signedUrl?: string | null } | null;
  error: unknown;
};

const SIGNED_URL_RETRY_DELAYS_MS = [0, 200, 750] as const;

export async function createSignedUrlWithRetry(
  createSignedUrl: () => Promise<SignedUrlResult>,
  wait: (delayMs: number) => Promise<void> = delay,
) {
  for (const delayMs of SIGNED_URL_RETRY_DELAYS_MS) {
    if (delayMs) await wait(delayMs);
    try {
      const { data, error } = await createSignedUrl();
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch {
      // Storage/network errors are retried below. The caller still receives a
      // null result after the bounded attempts and can surface a safe error.
    }
  }
  return null;
}

function delay(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
