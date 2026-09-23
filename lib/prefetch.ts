// A one-shot cache: a screen's onPress/onPressIn can kick a fetch off before
// navigation finishes, and the destination screen consumes (and clears) it
// instead of starting the same request over again. Not a general data cache —
// each entry is meant to be read exactly once, by the screen it was fetched for.
//
// Entries expire after a short while: a press-in that never turned into a
// navigation shouldn't leave stale data around to be served much later.
const MAX_AGE_MS = 30_000;
const cache = new Map<string, { promise: Promise<unknown>; at: number }>();

export function prefetch<T>(key: string, fetcher: () => Promise<T>): void {
  const existing = cache.get(key);
  if (!existing || Date.now() - existing.at > MAX_AGE_MS) {
    cache.set(key, { promise: fetcher(), at: Date.now() });
  }
}

export function consumePrefetch<T>(key: string): Promise<T> | undefined {
  const entry = cache.get(key);
  cache.delete(key);
  if (!entry || Date.now() - entry.at > MAX_AGE_MS) return undefined;
  return entry.promise as Promise<T>;
}

// Drop any pending entry, e.g. before an explicit refresh so it always
// goes to the network.
export function clearPrefetch(key: string): void {
  cache.delete(key);
}
