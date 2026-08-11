type CacheEntry<T> = {
  data: T;
  fetchedAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();

export function writeFetchCache<T>(key: string, data: T): void {
  store.set(key, { data, fetchedAt: Date.now() });
}

export function invalidateFetchCache(key?: string): void {
  if (key) {
    store.delete(key);
    return;
  }
  store.clear();
}

/**
 * Stale-while-revalidate: return cached data immediately when present,
 * refresh in the background. First load still awaits the network.
 */
export async function fetchWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: { ttlMs?: number } = {}
): Promise<{ data: T; fromCache: boolean; refreshing: boolean }> {
  const ttlMs = opts.ttlMs ?? 30_000;
  const hit = store.get(key) as CacheEntry<T> | undefined;
  const fresh = hit != null && Date.now() - hit.fetchedAt < ttlMs;

  if (hit && fresh) {
    return { data: hit.data, fromCache: true, refreshing: false };
  }

  if (hit) {
    void fetcher()
      .then((data) => {
        writeFetchCache(key, data);
      })
      .catch(() => {
        /* keep stale cache on background refresh failure */
      });
    return { data: hit.data, fromCache: true, refreshing: true };
  }

  const data = await fetcher();
  writeFetchCache(key, data);
  return { data, fromCache: false, refreshing: false };
}
