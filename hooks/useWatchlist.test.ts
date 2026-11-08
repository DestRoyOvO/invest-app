import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";
import { DEFAULT_WATCHLIST, MAX_WATCHLIST } from "@/lib/universe";
import type { Quote, QuotesResponse } from "@/types/api";

import {
  addTypedSymbol,
  type Fetcher,
  insertItem,
  LOOKUP_TIMEOUT_MS,
  lookUpSymbol,
  moveItem,
  planTypedAdd,
  sanitizeWatchlist,
  type SymbolLookup,
  WATCHLIST_STORAGE_KEY,
  watchlistActions,
  watchlistStore,
} from "./useWatchlist";

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

describe("typed symbols", () => {
  /** The quotes route as the app answers it: a quote for each known symbol, the others listed as missing. */
  function quotesRoute(known: readonly string[]) {
    const urls: string[] = [];
    const fetcher: Fetcher = async <T,>(url: string): Promise<T> => {
      urls.push(url);
      const symbols = (new URL(url, "http://local").searchParams.get("symbols") ?? "").split(",");
      const body: QuotesResponse = {
        asOf: "2026-11-07T15:00:00.000Z",
        quotes: symbols.filter((s) => known.includes(s)).map((symbol) => ({ symbol, name: symbol, price: 100 }) as Quote),
        missing: symbols.filter((s) => !known.includes(s)),
      };
      return body as T;
    };
    return { fetcher, urls };
  }

  /** A lookup that records the symbols it was asked about and answers `answer`. */
  function lookupAnswering(answer: SymbolLookup) {
    const asked: string[] = [];
    const lookup = async (symbol: string) => {
      asked.push(symbol);
      return answer;
    };
    return { lookup, asked };
  }

  it("settles malformed, listed and over-the-limit text at once and looks up anything else", () => {
    expect(planTypedAdd("not a ticker", ["AAPL"])).toEqual({ kind: "settled", result: "invalid" });
    expect(planTypedAdd("  aapl ", ["AAPL"])).toEqual({ kind: "settled", result: "exists" });
    expect(planTypedAdd("zzzz", Array.from({ length: MAX_WATCHLIST }, (_, i) => `S${i}`))).toEqual({ kind: "settled", result: "full" });
    expect(planTypedAdd(" zzzz", ["AAPL"])).toEqual({ kind: "lookup", symbol: "ZZZZ" });
    expect(planTypedAdd("brk-b", [])).toEqual({ kind: "lookup", symbol: "BRK-B" });
  });

  it("asks the quotes route behind the Not found notice and reads its missing list", async () => {
    const { fetcher, urls } = quotesRoute(["AAPL", "^GSPC"]);
    expect(await lookUpSymbol("AAPL", { fetcher })).toBe("known");
    expect(await lookUpSymbol("ZZZZ", { fetcher })).toBe("unknown");
    expect(await lookUpSymbol("^GSPC", { fetcher })).toBe("known");
    expect(urls).toEqual(["/api/quotes?symbols=AAPL", "/api/quotes?symbols=ZZZZ", "/api/quotes?symbols=%5EGSPC"]);
  });

  it("counts a failed lookup as no answer: offline, rate limited, a server error or a malformed body", async () => {
    const failing = (error: unknown): Fetcher => async () => {
      throw error;
    };
    expect(await lookUpSymbol("ZZZZ", { fetcher: failing(new ApiError(0, "network", "Network error")) })).toBe("unavailable");
    expect(await lookUpSymbol("ZZZZ", { fetcher: failing(new ApiError(429, "rate_limited", "Too many requests", 30)) })).toBe("unavailable");
    expect(await lookUpSymbol("ZZZZ", { fetcher: failing(new ApiError(502, "upstream_error", "Yahoo unavailable")) })).toBe("unavailable");
    // An answer without a missing list says nothing against the symbol.
    expect(await lookUpSymbol("ZZZZ", { fetcher: async <T,>() => ({ quotes: [] }) as T })).toBe("known");
  });

  it("stops waiting after the timeout and counts a slow lookup as no answer", async () => {
    vi.useFakeTimers();
    try {
      const pending = lookUpSymbol("ZZZZ", { fetcher: () => new Promise(() => {}) });
      await vi.advanceTimersByTimeAsync(LOOKUP_TIMEOUT_MS - 1);
      let settled: SymbolLookup | null = null;
      void pending.then((answer) => (settled = answer));
      await Promise.resolve();
      expect(settled).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toBe("unavailable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a symbol the data source does not know and saves nothing", async () => {
    watchlistStore.write(["NVDA", "AAPL"]);
    const { lookup, asked } = lookupAnswering("unknown");
    const outcome = addTypedSymbol("zzzz", lookup);
    expect(outcome).toBeInstanceOf(Promise);
    expect(await outcome).toBe("unknown");
    expect(asked).toEqual(["ZZZZ"]);
    expect(stored()).toEqual(["NVDA", "AAPL"]);
  });

  it("adds a known symbol, and one the lookup could not check, as before", async () => {
    watchlistStore.write(["NVDA"]);
    expect(await addTypedSymbol("amzn", lookupAnswering("known").lookup)).toBe("added");
    expect(await addTypedSymbol("tsla", lookupAnswering("unavailable").lookup)).toBe("added");
    // A lookup that throws counts as no answer as well.
    expect(await addTypedSymbol("meta", () => Promise.reject(new Error("boom")))).toBe("added");
    expect(stored()).toEqual(["NVDA", "AMZN", "TSLA", "META"]);
  });

  it("answers at once, without a lookup, for malformed text, a listed symbol and a full list", () => {
    watchlistStore.write(["NVDA", "AAPL"]);
    const { lookup, asked } = lookupAnswering("known");
    expect(addTypedSymbol("not a ticker", lookup)).toBe("invalid");
    expect(addTypedSymbol("aapl", lookup)).toBe("exists");
    watchlistStore.write(Array.from({ length: MAX_WATCHLIST }, (_, i) => `S${i}`));
    expect(addTypedSymbol("amzn", lookup)).toBe("full");
    expect(asked).toEqual([]);
  });

  it("checks the list again when the lookup answers, as another tab may have changed it meanwhile", async () => {
    watchlistStore.write(["NVDA"]);
    let answer: (value: SymbolLookup) => void = () => {};
    const outcome = addTypedSymbol("amzn", () => new Promise<SymbolLookup>((resolve) => (answer = resolve)));
    storage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(["NVDA", "AMZN"]));
    answer("known");
    expect(await outcome).toBe("exists");
    expect(stored()).toEqual(["NVDA", "AMZN"]);
  });

  it("goes through the quotes route by default", async () => {
    watchlistStore.write(["NVDA"]);
    const { fetcher, urls } = quotesRoute(["AMZN"]);
    vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(await fetcher<QuotesResponse>(url)), { status: 200 }));
    expect(await watchlistActions.addTyped("zzzz")).toBe("unknown");
    expect(await watchlistActions.addTyped("amzn")).toBe("added");
    expect(urls).toEqual(["/api/quotes?symbols=ZZZZ", "/api/quotes?symbols=AMZN"]);
    expect(stored()).toEqual(["NVDA", "AMZN"]);
  });
});
