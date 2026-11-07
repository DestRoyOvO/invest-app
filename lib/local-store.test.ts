import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLocalStore } from "./local-store";

class MemoryStorage {
  readonly map = new Map<string, string>();
  failWrites = false;
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.map.set(key, String(value));
  }
}

type StorageListener = (event: { key: string | null }) => void;

let storage: MemoryStorage;
let storageListeners: StorageListener[];

beforeEach(() => {
  storage = new MemoryStorage();
  storageListeners = [];
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: (_type: string, listener: StorageListener) => storageListeners.push(listener),
    removeEventListener: (_type: string, listener: StorageListener) => {
      storageListeners = storageListeners.filter((l) => l !== listener);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const EMPTY: string[] = [];
const sanitize = (raw: unknown) => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : EMPTY);

function makeStore(initial?: () => string[]) {
  return createLocalStore<string[]>({ key: "investseek:test:v1", sanitize, empty: EMPTY, initial });
}

describe("createLocalStore", () => {
  it("only accepts keys under the app prefix", () => {
    expect(() => createLocalStore({ key: "other:key", sanitize, empty: EMPTY })).toThrow(/investseek:/);
  });

  it("reads the initial value, a sanitized stored value, or the fallback for corrupt data", () => {
    expect(makeStore(() => ["AAPL"]).getSnapshot()).toEqual(["AAPL"]);
    storage.map.set("investseek:test:v1", JSON.stringify(["MSFT", 3, "NVDA"]));
    expect(makeStore().getSnapshot()).toEqual(["MSFT", "NVDA"]);
    storage.map.set("investseek:test:v1", "{not json");
    expect(makeStore(() => ["SPY"]).getSnapshot()).toEqual(["SPY"]);
  });

  it("keeps a stable snapshot and serves the empty value on the server", () => {
    const store = makeStore();
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    expect(store.getServerSnapshot()).toBe(EMPTY);
  });

  it("persists writes and notifies subscribers", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.write(["QQQ"]);
    expect(storage.map.get("investseek:test:v1")).toBe(JSON.stringify(["QQQ"]));
    expect(store.getSnapshot()).toEqual(["QQQ"]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("applies updates to what another tab stored meanwhile", () => {
    const store = makeStore();
    store.write(["A"]);
    storage.map.set("investseek:test:v1", JSON.stringify(["A", "B"]));
    const { update } = store;
    update((current) => [...current, "C"]);
    expect(store.getSnapshot()).toEqual(["A", "B", "C"]);
  });

  it("re-reads after a storage event for its key or a full clear, and ignores other keys", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.getSnapshot()).toEqual([]);

    storage.map.set("investseek:test:v1", JSON.stringify(["X"]));
    for (const l of storageListeners) l({ key: "investseek:other:v1" });
    expect(listener).not.toHaveBeenCalled();
    for (const l of storageListeners) l({ key: "investseek:test:v1" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual(["X"]);

    storage.map.set("investseek:test:v1", JSON.stringify(["Y"]));
    for (const l of storageListeners) l({ key: null });
    expect(store.getSnapshot()).toEqual(["Y"]);
  });

  it("registers one storage listener and removes it with the last subscriber", () => {
    const store = makeStore();
    const off1 = store.subscribe(() => {});
    const off2 = store.subscribe(() => {});
    expect(storageListeners).toHaveLength(1);
    off1();
    expect(storageListeners).toHaveLength(1);
    off2();
    expect(storageListeners).toHaveLength(0);
  });

  it("keeps working in memory when storage rejects writes", () => {
    const store = makeStore();
    storage.failWrites = true;
    store.write(["MEM"]);
    expect(store.getSnapshot()).toEqual(["MEM"]);
  });
});
