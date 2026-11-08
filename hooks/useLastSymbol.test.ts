import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

type StorageListener = (event: { key: string | null }) => void;

const KEY = "investseek:last-symbol";
let storage: MemoryStorage;
let storageListeners: StorageListener[];

/** What another tab, a restore (browserEnv.notify) or "Clear all data" does: change storage, then fire the event. */
function storageEvent(key: string | null, value?: string | null) {
  if (key !== null && value !== undefined) {
    if (value === null) storage.map.delete(key);
    else storage.map.set(key, value);
  }
  if (key === null) storage.map.clear();
  for (const listener of [...storageListeners]) listener({ key });
}

beforeEach(() => {
  storage = new MemoryStorage();
  storageListeners = [];
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: (type: string, listener: StorageListener) => {
      if (type === "storage") storageListeners.push(listener);
    },
    removeEventListener: (type: string, listener: StorageListener) => {
      if (type === "storage") storageListeners = storageListeners.filter((l) => l !== listener);
    },
  });
  // Fresh module state (the cached symbol) for every test.
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the last symbol", () => {
  it("reads the stored symbol, normalized, and falls back to AAPL", async () => {
    storage.setItem(KEY, " nvda ");
    const { lastSymbolStore } = await import("./useLastSymbol");
    expect(lastSymbolStore.getSnapshot()).toBe("NVDA");
    vi.resetModules();
    storage.map.clear();
    const fresh = await import("./useLastSymbol");
    expect(fresh.lastSymbolStore.getSnapshot()).toBe("AAPL");
  });

  it("follows another tab or a restore without a reload", async () => {
    storage.setItem(KEY, "AAPL");
    const { lastSymbolStore } = await import("./useLastSymbol");
    const listener = vi.fn();
    const unsubscribe = lastSymbolStore.subscribe(listener);
    expect(lastSymbolStore.getSnapshot()).toBe("AAPL");

    storageEvent(KEY, "TSLA");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(lastSymbolStore.getSnapshot()).toBe("TSLA");

    // Unrelated keys, and an event that changes nothing, leave it alone.
    storageEvent("investseek:recents:v1", '["MSFT"]');
    storageEvent(KEY, "TSLA");
    expect(listener).toHaveBeenCalledTimes(1);

    // "Clear all data" removes the key; another tab clearing everything sends key null.
    storageEvent(KEY, null);
    expect(lastSymbolStore.getSnapshot()).toBe("AAPL");
    storageEvent(KEY, "0700.HK");
    storageEvent(null);
    expect(lastSymbolStore.getSnapshot()).toBe("AAPL");
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
    expect(storageListeners).toHaveLength(0);
  });

  it("re-reads a change made while nothing listened", async () => {
    storage.setItem(KEY, "AAPL");
    const { lastSymbolStore } = await import("./useLastSymbol");
    expect(lastSymbolStore.getSnapshot()).toBe("AAPL");
    storage.setItem(KEY, "AMZN");
    const unsubscribe = lastSymbolStore.subscribe(() => {});
    expect(lastSymbolStore.getSnapshot()).toBe("AMZN");
    unsubscribe();
  });

  it("records a visit for the rail, the command bar and the recent symbols", async () => {
    const { lastSymbolStore, rememberSymbol } = await import("./useLastSymbol");
    const { recentsStore } = await import("./useRecents");
    const listener = vi.fn();
    lastSymbolStore.subscribe(listener);
    rememberSymbol("MSFT");
    expect(storage.getItem(KEY)).toBe("MSFT");
    expect(lastSymbolStore.getSnapshot()).toBe("MSFT");
    expect(recentsStore.getSnapshot()).toEqual(["MSFT"]);
    expect(listener).toHaveBeenCalledTimes(1);
    rememberSymbol("MSFT");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
