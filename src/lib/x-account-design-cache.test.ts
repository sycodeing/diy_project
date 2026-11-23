import assert from "node:assert/strict";
import test from "node:test";
import { resolveAccountDesignCache } from "./x-account-design-cache.ts";

test("persistent warm hit performs no render; concurrent cold requests share one render", async () => {
  const inflight = new Map<string, Promise<string>>();
  const stored = new Map<string, string>();
  let renders = 0;
  const resolve = (key: string) => resolveAccountDesignCache(inflight, key,
    async () => stored.get(key) ?? null,
    async () => { renders++; await new Promise((done) => setTimeout(done, 5)); stored.set(key, `image-${key}`); return `image-${key}`; });
  assert.deepEqual(await Promise.all([resolve("art:template:revision-a"), resolve("art:template:revision-a")]),
    ["image-art:template:revision-a", "image-art:template:revision-a"]);
  assert.equal(renders, 1);
  assert.equal(await resolve("art:template:revision-a"), "image-art:template:revision-a");
  assert.equal(renders, 1);
  assert.equal(await resolve("art:template:revision-b"), "image-art:template:revision-b");
  assert.equal(renders, 2, "a changed template fingerprint must miss");
});

test("corrupt or failed cache never becomes a ready hit", async () => {
  const inflight = new Map<string, Promise<string>>();
  let renders = 0;
  const result = await resolveAccountDesignCache(inflight, "bad", async () => null,
    async () => { renders++; return "valid-render"; });
  assert.equal(result, "valid-render");
  assert.equal(renders, 1);
  await assert.rejects(resolveAccountDesignCache(inflight, "failed", async () => null,
    async () => { throw new Error("renderer failed"); }), /renderer failed/);
  assert.equal(inflight.size, 0, "a failed render can be retried");
});
