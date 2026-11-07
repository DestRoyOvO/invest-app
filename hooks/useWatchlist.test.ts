import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_WATCHLIST, MAX_WATCHLIST } from "@/lib/universe";

import { insertItem, moveItem, sanitizeWatchlist, WATCHLIST_STORAGE_KEY, watchlistActions, watchlistStore } from "./useWatchlist";

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage, addEventListener: () => {}, removeEventListener: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stored(): string[] | null {
  const raw = storage.getItem(WATCHLIST_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe("moveItem and insertItem", () => {
  it("moves an item to an index and clamps out-of-range targets", () => {
    expect(moveItem(["A", "B", "C", "D"], "A", 2)).toEqual(["B", "C", "A", "D"]);
    expect(moveItem(["A", "B", "C", "D"], "D", 0)).toEqual(["D", "A", "B", "C"]);
    expect(moveItem(["A", "B", "C"], "B", 99)).toEqual(["A", "C", "B"]);
    expect(moveItem(["A", "B", "C"], "B", -5)).toEqual(["B", "A", "C"]);
    const list = ["A", "B"];
    expect(moveItem(list, "A", 0)).toBe(list);
    expect(moveItem(list, "Z", 1)).toBe(list);
  });

  it("inserts in place and never duplicates", () => {
    expect(insertItem(["A", "C"], "B", 1)).toEqual(["A", "B", "C"]);
    expect(insertItem(["A", "B"], "C", 10)).toEqual(["A", "B", "C"]);
    const list = ["A", "B"];
    expect(insertItem(list, "A", 1)).toBe(list);
  });
});

describe("watchlist store", () => {
  it("starts new visitors with the default list and keeps a cleared list empty", () => {
    watchlistActions.add("TSLA");
    expect(stored()).toEqual([...DEFAULT_WATCHLIST, "TSLA"]);
    storage.setItem(WATCHLIST_STORAGE_KEY, "[]");
    watchlistActions.add("aapl");
    expect(stored()).toEqual(["AAPL"]);
  });

  it("reports duplicates, invalid tickers and a full list", () => {
    storage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(["AAPL"]));
    expect(watchlistActions.add("AAPL")).toBe("exists");
    expect(watchlistActions.add("not a ticker")).toBe("invalid");
    storage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(Array.from({ length: MAX_WATCHLIST }, (_, i) => `S${i}`)));
    expect(watchlistActions.add("ONEMORE")).toBe("full");
  });

  it("reorders without touching other symbols and restores a removal in place", () => {
    storage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(["A", "B", "C", "D"]));
    watchlistActions.moveTo("D", 1);
    expect(stored()).toEqual(["A", "D", "B", "C"]);
    watchlistActions.move("A", 1);
    expect(stored()).toEqual(["D", "A", "B", "C"]);
    watchlistActions.move("D", -1);
    expect(stored()).toEqual(["D", "A", "B", "C"]);
    watchlistActions.remove("B");
    expect(stored()).toEqual(["D", "A", "C"]);
    expect(watchlistActions.insertAt("B", 2)).toBe("added");
    expect(stored()).toEqual(["D", "A", "B", "C"]);
    expect(watchlistStore.getSnapshot()).toEqual(["D", "A", "B", "C"]);
  });

  it("sanitizes imported lists", () => {
    expect(sanitizeWatchlist("nope")).toEqual(DEFAULT_WATCHLIST);
    expect(sanitizeWatchlist(["aapl", "AAPL", 3, "bad ticker", "msft"])).toEqual(["AAPL", "MSFT"]);
  });
});
