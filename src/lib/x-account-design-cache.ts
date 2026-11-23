/** Coalesces one cold render per key in this process; persistent storage remains the source of cache hits. */
export async function resolveAccountDesignCache<T>(inflight: Map<string, Promise<T>>, key: string,
  lookup: () => Promise<T | null>, renderAndStore: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key);
  if (pending) return pending;
  const work = (async () => await lookup() ?? await renderAndStore())();
  inflight.set(key, work);
  try { return await work; } finally { inflight.delete(key); }
}
