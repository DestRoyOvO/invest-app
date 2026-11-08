import { describe, expect, it } from "vitest";

import { en, zh } from "@/lib/i18n/messages";
import { valuePortfolio } from "@/lib/portfolio";
import type { Quote } from "@/types/api";

import { dayFigures, dayLabel, dayTileCount, extendedLabel, formatSessionDate } from "./day-figures";

function quote(symbol: string, patch: Partial<Quote>): Quote {
  return {
    symbol,
    price: null,
    change: null,
    currency: "USD",
    extendedSession: null,
    extendedChange: null,
    regularMarketTime: "2026-11-06T21:00:00Z",
    ...patch,
  } as Quote;
}

const quotes = new Map<string, Quote>([
  ["AAPL", quote("AAPL", { price: 200, change: 2, extendedSession: "POST", extendedChange: 1 })],
  ["MSFT", quote("MSFT", { price: 400, change: -4 })],
  ["7203.T", quote("7203.T", { price: 3000, change: 30, currency: "JPY" })],
]);
const portfolio = valuePortfolio(
  [
    { symbol: "AAPL", shares: 10, cost: 150 },
    { symbol: "MSFT", shares: 5, cost: 300 },
    { symbol: "7203.T", shares: 100, cost: 2500 },
  ],
  (s) => quotes.get(s),
);
// Saturday 2026-11-07 19:30 in New York, and Friday 15:00 during the session.
const saturday = Date.parse("2026-11-08T00:30:00Z");
const friday = Date.parse("2026-11-06T20:00:00Z");

describe("dayFigures", () => {
  it("sums the base-currency positions and weights the day by value", () => {
    const f = dayFigures(portfolio, quotes, friday);
    expect(f).toMatchObject({ currency: "USD", value: 4000, dayPnl: 0, costBasis: 3000, pnl: 1000, positions: 2 });
    // +20 on AAPL and -20 on MSFT: flat on a previous value of 4000.
    expect(f.dayRatio).toBe(0);
    expect(f.pnlPct).toBeCloseTo(1 / 3);
  });

  it("keeps after-hours P&L apart from the day P&L", () => {
    const f = dayFigures(portfolio, quotes, friday);
    expect(f.extended).toEqual({ session: "POST", pnl: 10, ratio: 10 / 2000, positions: 1 });
    expect(f.dayPnl).toBe(0);
  });

  it("says which session the day covers while the market has not traded today", () => {
    expect(dayFigures(portfolio, quotes, friday).sessionDate).toBeNull();
    expect(dayFigures(portfolio, quotes, saturday).sessionDate).toBe(Date.UTC(2026, 10, 6));
    expect(dayFigures(portfolio, quotes, 0).sessionDate).toBeNull();
  });
});

describe("day labels", () => {
  it("labels today or the last session", () => {
    expect(dayLabel(dayFigures(portfolio, quotes, friday), en)).toBe("Today");
    expect(dayLabel(dayFigures(portfolio, quotes, saturday), en)).toBe("Last session");
    expect(dayLabel(dayFigures(portfolio, quotes, saturday), zh)).toBe("上一交易日");
  });

  it("formats the session date with its weekday", () => {
    expect(formatSessionDate(Date.UTC(2026, 10, 6), "en")).toBe("Fri, Nov 6");
    expect(formatSessionDate(Date.UTC(2026, 10, 6), "zh")).toBe("11月6日周五");
  });

  it("names the extended session", () => {
    expect(extendedLabel("PRE", en)).toBe("Pre-market P&L");
    expect(extendedLabel("POST", en)).toBe("After-hours P&L");
    expect(extendedLabel("MIXED", en)).toBe("Extended-hours P&L");
  });
});

describe("dayTileCount", () => {
  it("counts the optional cost basis and extended-hours tiles", () => {
    const withExt = dayFigures(portfolio, quotes, friday);
    expect(dayTileCount(withExt, false)).toBe(4);
    expect(dayTileCount(withExt, true)).toBe(5);
    expect(dayTileCount({ ...withExt, extended: null }, false)).toBe(3);
  });
});
