import { describe, expect, it } from "vitest";

import { sanitizeHoldings, valuePositions } from "./useHoldings";

describe("holdings", () => {
  it("sanitizes stored data", () => {
    expect(sanitizeHoldings(null)).toEqual({});
    expect(sanitizeHoldings([1, 2])).toEqual({});
    expect(
      sanitizeHoldings({
        aapl: { shares: 10, cost: 150 },
        BAD$: { shares: 1, cost: 1 },
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
});
