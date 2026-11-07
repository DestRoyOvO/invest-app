import { describe, expect, it } from "vitest";

import { pickBaseCurrency, valuePortfolio, type QuoteLike } from "./portfolio";

function quotes(entries: Record<string, QuoteLike>) {
  return (symbol: string) => entries[symbol];
}

describe("valuePortfolio", () => {
  it("values positions, weights and totals in one currency", () => {
    const portfolio = valuePortfolio(
      [
        { symbol: "AAPL", shares: 10, cost: 150 },
        { symbol: "MSFT", shares: 6, cost: 500 },
      ],
      quotes({ AAPL: { price: 200, change: 2, currency: "USD" }, MSFT: { price: 400, change: -4, currency: null } }),
    );
    expect(portfolio.baseCurrency).toBe("USD");
    expect(portfolio.rows.map((row) => row.symbol)).toEqual(["MSFT", "AAPL"]);
    const aapl = portfolio.rows.find((row) => row.symbol === "AAPL");
    expect(aapl).toMatchObject({ value: 2000, costBasis: 1500, pnl: 500, dayPnl: 20, currency: "USD" });
    expect(aapl?.pnlPct).toBeCloseTo(1 / 3);
    expect(portfolio.totals).toEqual({ value: 4400, costBasis: 4500, dayPnl: -4, pnl: -100, pnlPct: -100 / 4500 });
    expect(portfolio.rows.reduce((sum, row) => sum + (row.weight ?? 0), 0)).toBeCloseTo(1);
    expect(portfolio.foreign).toEqual([]);
    expect(portfolio.unpriced).toEqual([]);
  });

  it("keeps other currencies out of the totals instead of adding them up", () => {
    const portfolio = valuePortfolio(
      [
        { symbol: "AAPL", shares: 10, cost: 150 },
        { symbol: "NVDA", shares: 1, cost: 100 },
        { symbol: "7203.T", shares: 100, cost: 2500 },
      ],
      quotes({
        AAPL: { price: 200, change: 1, currency: "USD" },
        NVDA: { price: 180, change: 2, currency: "USD" },
        "7203.T": { price: 3000, change: 50, currency: "JPY" },
      }),
    );
    expect(portfolio.baseCurrency).toBe("USD");
    expect(portfolio.totals.value).toBe(2180);
    expect(portfolio.foreign).toHaveLength(1);
    expect(portfolio.foreign[0]).toMatchObject({ symbol: "7203.T", currency: "JPY", value: 300_000, weight: null, dayPnl: 5000 });
  });

  it("lists positions without a usable price instead of dropping them", () => {
    const portfolio = valuePortfolio(
      [
        { symbol: "AAPL", shares: 10, cost: 150 },
        { symbol: "GONE", shares: 5, cost: 20 },
        { symbol: "ZERO", shares: 1, cost: 1 },
        { symbol: "NAN", shares: 1, cost: 1 },
      ],
      quotes({ AAPL: { price: 200, change: null, currency: "USD" }, ZERO: { price: 0, change: 0, currency: "USD" }, NAN: { price: Number.NaN, change: 0, currency: "USD" } }),
    );
    expect(portfolio.unpriced.map((position) => position.symbol)).toEqual(["GONE", "ZERO", "NAN"]);
    expect(portfolio.rows.map((row) => row.symbol)).toEqual(["AAPL"]);
    expect(portfolio.totals).toMatchObject({ value: 2000, dayPnl: 0 });
    expect(portfolio.rows[0].dayPnl).toBeNull();
  });

  it("returns empty totals for an empty or unpriced portfolio", () => {
    const portfolio = valuePortfolio([{ symbol: "GONE", shares: 1, cost: 1 }], () => undefined);
    expect(portfolio.rows).toEqual([]);
    expect(portfolio.totals).toEqual({ value: 0, costBasis: 0, dayPnl: 0, pnl: 0, pnlPct: null });
    expect(portfolio.baseCurrency).toBe("USD");
  });
});

describe("pickBaseCurrency", () => {
  it("takes the most common currency and prefers USD on a tie", () => {
    expect(pickBaseCurrency([])).toBe("USD");
    expect(pickBaseCurrency(["JPY", "JPY", "USD"])).toBe("JPY");
    expect(pickBaseCurrency(["JPY", "USD"])).toBe("USD");
    expect(pickBaseCurrency(["JPY", "EUR"])).toBe("EUR");
    expect(pickBaseCurrency(["GBp", "GBP", "GBp"])).toBe("GBp");
  });
});
