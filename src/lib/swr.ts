import { useCallback, useEffect, useRef, useState } from "react";

// A tiny stale-while-revalidate cache. The store lives at module scope so it
// outlives component remounts — when MainPane swaps the active table it remounts
// DataTab via `key`, yet revisiting a query still paints instantly from the last
// known result while fresh data loads quietly in the background.
const store = new Map<string, unknown>();

/** Drop the whole cache — e.g. after a write that could touch any cached query. */
export function evictAll() {
  store.clear();
}

export interface Swr<T> {
  /** Best data we have for this key: fresh, or stale while revalidating. */
  data: T | null;
  error: string | null;
  /** First load of a key with nothing cached — nothing to show yet. */
  loading: boolean;
  /** Refreshing a key whose stale data is already on screen. */
  revalidating: boolean;
  /** Re-run the fetch for the current key (bypasses the cached snapshot). */
  refetch: () => void;
}

/**
 * Fetch `key`'s data, preferring a cached snapshot for the instant first paint.
 *
 * Pass `key = null` to stay idle (no key, no fetch). The `fetcher` may close over
 * fresh values every render; only a change of `key` (or `refetch()`) re-runs it.
 */
export function useSwr<T>(key: string | null, fetcher: () => Promise<T>): Swr<T> {
  const cached = key !== null ? ((store.get(key) as T | undefined) ?? null) : null;

  const [data, setData] = useState<T | null>(cached);
  const [error, setError] = useState<string | null>(null);
  // Start busy when we have a key but nothing cached, so the very first render
  // shows a loader instead of a one-frame "empty" flash.
  const [fetching, setFetching] = useState(cached === null && key !== null);

  // Keep the latest fetcher without making it a dependency: callers rebuild the
  // closure each render, but we only want key changes / refetch() to re-run it.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // The key whose response we still care about. Lets us discard results from a
  // request that a faster table/page switch has already superseded.
  const activeKey = useRef(key);

  const run = useCallback(async () => {
    if (key === null) return;
    activeKey.current = key;
    setFetching(true);
    setError(null);
    try {
      const r = await fetcherRef.current();
      store.set(key, r);
      if (activeKey.current === key) {
        setData(r);
        setFetching(false);
      }
    } catch (e) {
      if (activeKey.current === key) {
        setError(String(e));
        setFetching(false);
      }
    }
  }, [key]);

  useEffect(() => {
    // Paint whatever the cache holds for this key, then revalidate.
    setData(key !== null ? ((store.get(key) as T | undefined) ?? null) : null);
    setError(null);
    void run();
  }, [key, run]);

  const hasData = data !== null;
  return {
    data,
    error,
    loading: fetching && !hasData,
    revalidating: fetching && hasData,
    refetch: run,
  };
}
