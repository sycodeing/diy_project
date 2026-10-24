import assert from "node:assert/strict";
import test from "node:test";
import { createSignedUrlWithRetry } from "./storage-signed-url.ts";

test("retries transient signed URL failures and returns the later URL", async () => {
  let calls = 0;
  const waits: number[] = [];
  const signedUrl = await createSignedUrlWithRetry(async () => {
    calls += 1;
    if (calls === 1) return { data: null, error: new Error("temporary storage failure") };
    return { data: { signedUrl: "https://storage.example/signed" }, error: null };
  }, async (delayMs) => {
    waits.push(delayMs);
  });

  assert.equal(signedUrl, "https://storage.example/signed");
  assert.equal(calls, 2);
  assert.deepEqual(waits, [200]);
});

test("returns null after bounded signed URL attempts", async () => {
  let calls = 0;
  const signedUrl = await createSignedUrlWithRetry(async () => {
    calls += 1;
    throw new Error("temporary storage failure");
  }, async () => undefined);

  assert.equal(signedUrl, null);
  assert.equal(calls, 3);
});
