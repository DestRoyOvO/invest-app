import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearPosition, HOLDINGS_STORAGE_KEY, holdingsStore, sanitizeHoldings, setPosition, valuePositions } from "./useHoldings";

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

function stored() {
  const raw = storage.getItem(HOLDINGS_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe("holdings", () => {
  it("sanitizes stored data", () => {
    expect(sanitizeHoldings(null)).toEqual({});
    expect(sanitizeHoldings([1, 2])).toEqual({});
    expect(
      sanitizeHoldings({
        aapl: { shares: 10, cost: 150 },
        "BAD SYMBOL": { shares: 1, cost: 1 },
        MSFT: { shares: -1, cost: 100 },
        NVDA: { shares: 5, cost: "100" },
      }),
    ).toEqual({ AAPL: { shares: 10, cost: 150 } });
  });

  it("values stored positions through the shared portfolio rules", () => {
    const quotes = new Map([
      ["AAPL", { price: 200, change: 2, currency: "USD" }],
      ["MSFT", { price: 400, change: -4, currency: "USD" }],
      ["NOPRICE", { price: null, change: null, currency: "USD" }],
    ]);
    const portfolio = valuePositions({ AAPL: { shares: 10, cost: 150 }, MSFT: { shares: 6, cost: 500 }, NOPRICE: { shares: 1, cost: 1 } }, quotes);
    expect(portfolio.rows.map((r) => r.symbol)).toEqual(["MSFT", "AAPL"]);
    expect(portfolio.unpriced.map((p) => p.symbol)).toEqual(["NOPRICE"]);
    expect(portfolio.totals).toMatchObject({ value: 4400, costBasis: 4500, pnl: -100, dayPnl: -4 });
  });

  it("saves, replaces and clears positions in storage", () => {
    expect(setPosition("nvda", { shares: 40, cost: 118.5 })).toBe(true);
    expect(setPosition("AAPL", { shares: 10, cost: 150 })).toBe(true);
    expect(stored()).toEqual({ NVDA: { shares: 40, cost: 118.5 }, AAPL: { shares: 10, cost: 150 } });
    expect(setPosition("AAPL", { shares: 12, cost: 155 })).toBe(true);
    expect(holdingsStore.getSnapshot().AAPL).toEqual({ shares: 12, cost: 155 });
    clearPosition("NVDA");
    expect(stored()).toEqual({ AAPL: { shares: 12, cost: 155 } });
  });

  it("rejects invalid positions without writing", () => {
    expect(setPosition("AAPL", { shares: 0, cost: 150 })).toBe(false);
    expect(setPosition("AAPL", { shares: 1, cost: Number.NaN })).toBe(false);
    expect(setPosition("not a symbol", { shares: 1, cost: 1 })).toBe(false);
    expect(stored()).toBeNull();
  });

  it("starts each change from what another tab saved", () => {
    storage.setItem(HOLDINGS_STORAGE_KEY, JSON.stringify({ MSFT: { shares: 6, cost: 500 } }));
    setPosition("AAPL", { shares: 1, cost: 2 });
    expect(stored()).toEqual({ MSFT: { shares: 6, cost: 500 }, AAPL: { shares: 1, cost: 2 } });
  });
});
