import { describe, expect, it } from "vitest";

import { trailingReturns } from "./etf-returns";

const DAY = 86_400_000;

/** Consecutive sessions ending on 2026-11-06, one close each, from a starting price growing by `step` a day. */
function series(count: number, start = 100, step = 1): { dates: number[]; closes: number[] } {
  const end = Date.UTC(2026, 10, 6);
  const dates = Array.from({ length: count }, (_, i) => end - (count - 1 - i) * DAY);
  return { dates, closes: dates.map((_, i) => start + i * step) };
}

describe("trailingReturns", () => {
  it("measures 1W, 1M and 3M over 5, 21 and 63 sessions", () => {
    const { dates, closes } = series(100);
    const last = closes[99];
    const result = trailingReturns(dates, closes);
    expect(result.w1).toBeCloseTo(last / closes[94] - 1);
    expect(result.m1).toBeCloseTo(last / closes[78] - 1);
    expect(result.m3).toBeCloseTo(last / closes[36] - 1);
  });

  it("measures year to date from the last close of the previous year", () => {
    const { dates, closes } = series(400);
    const base = dates.findLastIndex((t) => t < Date.UTC(2026, 0, 1));
    expect(new Date(dates[base]).toISOString().slice(0, 10)).toBe("2025-12-31");
    expect(trailingReturns(dates, closes).ytd).toBeCloseTo(closes[399] / closes[base] - 1);
  });

  it("skips missing closes and leaves out returns without enough history", () => {
    const { dates, closes } = series(30);
    const gappy: Array<number | null> = closes.map((c, i) => (i === 27 ? null : c));
    const result = trailingReturns(dates, gappy);
    // Five of the symbol's own sessions back from the last bar, stepping over the gap.
    expect(result.w1).toBeCloseTo(closes[29] / closes[23] - 1);
    expect(result.m3).toBeNull();
    expect(result.ytd).toBeNull();
    expect(trailingReturns([], [])).toEqual({ w1: null, m1: null, m3: null, ytd: null });
    expect(trailingReturns(dates, dates.map(() => null))).toEqual({ w1: null, m1: null, m3: null, ytd: null });
  });
});
