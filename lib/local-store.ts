// Small external stores backed by localStorage, for data that lives only in this browser (watchlist, positions,
// notes, alerts, saved screens). Each store is read through React's useSyncExternalStore (hooks/useLocalStore.ts), so
// every component and every open tab stays in sync and server rendering sees the empty value.
//
// Writes re-read storage first (update), so an edit in one tab never overwrites what another tab saved meanwhile.
// When storage is unavailable (private mode, quota) the store keeps working in memory for the session.

/** Every key this app writes starts with this prefix; backups export exactly these keys. */
export const STORAGE_PREFIX = "investseek:";

export interface LocalStore<T> {
  readonly key: string;
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
  getServerSnapshot(): T;
  /** Replaces the stored value. */
  write(next: T): void;
  /** Read-modify-write against the latest stored value. */
  update(change: (current: T) => T): void;
  /** Sanitizes an untrusted value (an import, another tab's write) into this store's shape. */
  sanitize(raw: unknown): T;
}

export interface LocalStoreOptions<T> {
  /** Full storage key, including STORAGE_PREFIX and a version suffix, e.g. "investseek:notes:v1". */
  key: string;
  /** Turns whatever is stored (possibly corrupt, from an old version or hand-edited) into a valid value. */
  sanitize: (raw: unknown) => T;
  /** Value on the server and while nothing is stored. Must be a stable reference. */
  empty: T;
  /** Value when the key has never been written (defaults to `empty`), e.g. a starter watchlist. */
  initial?: () => T;
}

export function createLocalStore<T>({ key, sanitize, empty, initial }: LocalStoreOptions<T>): LocalStore<T> {
  if (!key.startsWith(STORAGE_PREFIX)) throw new Error(`Local store keys must start with "${STORAGE_PREFIX}"`);
  const listeners = new Set<() => void>();
  let snapshot: T | null = null;

  const fallback = () => (initial ? initial() : empty);

  function read(): T {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback() : sanitize(JSON.parse(raw));
    } catch {
      return fallback();
    }
  }

  function emit() {
    for (const listener of listeners) listener();
  }

  function write(next: T) {
    snapshot = next;
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Keep the in-memory value when storage is unavailable.
    }
    emit();
  }

  function onStorage(event: StorageEvent) {
    // key is null when another tab cleared all storage.
    if (event.key === key || event.key === null) {
      snapshot = null;
      emit();
    }
  }

  return {
    key,
    sanitize,
    subscribe(listener) {
      // While nothing was subscribed, another tab may have changed storage without this tab hearing the event.
      if (listeners.size === 0) {
        snapshot = null;
        window.addEventListener("storage", onStorage);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot() {
      if (snapshot === null) snapshot = read();
      return snapshot;
    },
    getServerSnapshot() {
      return empty;
    },
    write,
    update(change) {
      write(change(read()));
    },
  };
}
