import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_RECENTS, pushRecent, sanitizeRecents, sanitizeSector } from "./useRecents";

class MemoryStorage {
  readonly map = new Map<string, string>();
  writes = 0;
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.writes++;
    this.map.set(key, String(value));
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage, addEventListener: () => {}, removeEventListener: () => {} });
  // Fresh module state (store snapshots) for every test.
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pushRecent and sanitizeRecents", () => {
  it("moves a symbol to the front and keeps at most eight", () => {
    expect(pushRecent(["AAPL", "MSFT"], "NVDA")).toEqual(["NVDA", "AAPL", "MSFT"]);
    expect(pushRecent(["AAPL", "MSFT", "NVDA"], "NVDA")).toEqual(["NVDA", "AAPL", "MSFT"]);
    const full = ["A", "B", "C", "D", "E", "F", "G", "H"];
    expect(pushRecent(full, "Z")).toEqual(["Z", "A", "B", "C", "D", "E", "F", "G"]);
    expect(MAX_RECENTS).toBe(8);
  });

  it("turns stored data into normalized, unique, capped symbols", () => {
    expect(sanitizeRecents(["nvda", "NVDA", 42, "not a ticker!", "^gspc"])).toEqual(["NVDA", "^GSPC"]);
    expect(sanitizeRecents("AAPL")).toEqual([]);
    expect(sanitizeRecents(null)).toEqual([]);
    expect(sanitizeRecents(Array.from({ length: 20 }, (_, i) => `S${i}`))).toHaveLength(8);
  });

  it("accepts only known sector keys", () => {
    expect(sanitizeSector("energy")).toBe("energy");
    expect(sanitizeSector("Energy")).toBeNull();
    expect(sanitizeSector(3)).toBeNull();
  });
});

describe("the recents store", () => {
  it("records visits newest first under investseek:recents:v1", async () => {
    const { addRecent, recentsStore, RECENTS_STORAGE_KEY } = await import("./useRecents");
    expect(RECENTS_STORAGE_KEY).toBe("investseek:recents:v1");
    addRecent("aapl");
    addRecent("MSFT");
    addRecent("AAPL");
    expect(recentsStore.getSnapshot()).toEqual(["AAPL", "MSFT"]);
    expect(JSON.parse(storage.map.get(RECENTS_STORAGE_KEY) ?? "[]")).toEqual(["AAPL", "MSFT"]);
  });

  it("ignores invalid symbols and does not rewrite when the newest symbol is visited again", async () => {
    const { addRecent, recentsStore } = await import("./useRecents");
    addRecent("NVDA");
    const writes = storage.writes;
    addRecent("NVDA");
    addRecent("no way");
    expect(storage.writes).toBe(writes);
    expect(recentsStore.getSnapshot()).toEqual(["NVDA"]);
  });

  it("reads what another tab stored, sanitized", async () => {
    storage.map.set("investseek:recents:v1", JSON.stringify(["tsla", "bad symbol", "KO"]));
    const { recentsStore } = await import("./useRecents");
    expect(recentsStore.getSnapshot()).toEqual(["TSLA", "KO"]);
  });

  it("is fed by rememberSymbol, which still records the last symbol", async () => {
    const { rememberSymbol } = await import("./useLastSymbol");
    const { recentsStore } = await import("./useRecents");
    rememberSymbol("NVDA");
    rememberSymbol("KO");
    expect(recentsStore.getSnapshot()).toEqual(["KO", "NVDA"]);
    expect(storage.map.get("investseek:last-symbol")).toBe("KO");
  });
});

describe("the last sector", () => {
  it("keeps the last valid sector key", async () => {
    const { lastSectorStore, rememberSector, LAST_SECTOR_STORAGE_KEY } = await import("./useRecents");
    expect(lastSectorStore.getSnapshot()).toBeNull();
    rememberSector("energy");
    rememberSector("not-a-sector");
    expect(lastSectorStore.getSnapshot()).toBe("energy");
    expect(storage.map.get(LAST_SECTOR_STORAGE_KEY)).toBe(JSON.stringify("energy"));
    const writes = storage.writes;
    rememberSector("energy");
    expect(storage.writes).toBe(writes);
  });
});
