// A one-shot cache: a screen's onPress/onPressIn can kick a fetch off before
// navigation finishes, and the destination screen consumes (and clears) it
// instead of starting the same request over again. Not a general data cache —
// each entry is meant to be read exactly once, by the screen it was fetched for.
const cache = new Map<string, Promise<unknown>>();

export function prefetch<T>(key: string, fetcher: () => Promise<T>): void {
  if (!cache.has(key)) {
    cache.set(key, fetcher());
  }
}

export function consumePrefetch<T>(key: string): Promise<T> | undefined {
  const entry = cache.get(key) as Promise<T> | undefined;
  cache.delete(key);
  return entry;
}
