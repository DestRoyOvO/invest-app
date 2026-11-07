import "server-only";

// Small in-process TTL cache with in-flight de-duplication and stale-on-error.
// It lives on globalThis so dev-mode module reloads keep it, and is bounded so memory stays flat.
// On multi-instance hosting each instance has its own cache, which is fine for Yahoo data.

interface Entry<T> {
  value?: T;
  hasValue: boolean;
  expiresAt: number;
  staleUntil: number;
  inflight?: Promise<T>;
}

export interface CacheOptions {
  /** How long a value is served without refreshing. */
  ttlMs: number;
  /** If a refresh fails, keep serving the previous value for up to this long after it expired. */
  staleMs?: number;
}

const MAX_ENTRIES = 3000;

const globalStore = globalThis as unknown as { __investseekCache?: Map<string, Entry<unknown>> };
const store: Map<string, Entry<unknown>> = (globalStore.__investseekCache ??= new Map());

function evictIfNeeded() {
  if (store.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of store) {
    if (!entry.inflight && entry.staleUntil < now) store.delete(key);
  }
  // Still too big: drop the oldest insertions (Map iterates in insertion order).
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/**
 * Returns the cached value for `key`, loading it with `load` when missing or expired.
 * Concurrent callers for the same key share one in-flight load.
 */
export async function cached<T>(key: string, options: CacheOptions, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = store.get(key) as Entry<T> | undefined;

  if (existing?.hasValue && existing.expiresAt > now) return existing.value as T;
  if (existing?.inflight) return existing.inflight;

  const entry: Entry<T> = existing ?? { hasValue: false, expiresAt: 0, staleUntil: 0 };
  const promise = (async () => {
    try {
      const value = await load();
      const loadedAt = Date.now();
      entry.value = value;
      entry.hasValue = true;
      entry.expiresAt = loadedAt + options.ttlMs;
      entry.staleUntil = loadedAt + options.ttlMs + (options.staleMs ?? 0);
      // Move refreshed keys to the newest end so frequently used entries are evicted last.
      store.delete(key);
      store.set(key, entry as Entry<unknown>);
      return value;
    } catch (error) {
      if (entry.hasValue && entry.staleUntil > Date.now()) return entry.value as T;
      throw error;
    } finally {
      entry.inflight = undefined;
    }
  })();

  entry.inflight = promise;
  store.set(key, entry as Entry<unknown>);
  evictIfNeeded();
  return promise;
}

/** Reads a fresh-or-stale value without loading. */
export function peek<T>(key: string): T | undefined {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry?.hasValue || entry.staleUntil < Date.now()) return undefined;
  return entry.value;
}

/** Stores a value directly (used to index items such as news by id). */
export function put<T>(key: string, value: T, options: CacheOptions): void {
  const now = Date.now();
  // Re-insert so a refreshed key moves to the newest end of the eviction order.
  store.delete(key);
  store.set(key, {
    value,
    hasValue: true,
    expiresAt: now + options.ttlMs,
    staleUntil: now + options.ttlMs + (options.staleMs ?? 0),
  } as Entry<unknown>);
  evictIfNeeded();
}

/** Test helper. */
export function clearCache(): void {
  store.clear();
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
