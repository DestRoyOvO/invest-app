import { describe, expect, it } from "vitest";

import type { QuintileRow } from "@/lib/evaluation";

import { bandLayout, exchangeDate, horizonMove, quintileRow, rangeOffset, reportWithinHorizon, volatilityQuintile, weekdaysBetween } from "./risk-math";

const BREAKPOINTS = [0.2188, 0.25965, 0.30936, 0.37398];

describe("volatilityQuintile", () => {
  it("takes ceil(percentile / 20), clamped to 1..5", () => {
    expect(volatilityQuintile(72, null, null)).toBe(4);
    expect(volatilityQuintile(0, null, null)).toBe(1);
    expect(volatilityQuintile(20, null, null)).toBe(1);
    expect(volatilityQuintile(20.1, null, null)).toBe(2);
    expect(volatilityQuintile(100, null, null)).toBe(5);
  });

  it("falls back to the quintile boundaries without a percentile", () => {
    expect(volatilityQuintile(null, 0.3, BREAKPOINTS)).toBe(3);
    expect(volatilityQuintile(null, 0.1, BREAKPOINTS)).toBe(1);
    expect(volatilityQuintile(null, 0.5, BREAKPOINTS)).toBe(5);
    expect(volatilityQuintile(null, null, BREAKPOINTS)).toBeNull();
    expect(volatilityQuintile(null, 0.3, [0.2, 0.3])).toBeNull();
  });

  it("finds a quintile's row", () => {
    const rows: QuintileRow[] = [1, 2, 3, 4, 5].map((quintile) => ({ quintile, n: 10, medianVolatility: 0.1 * quintile, drawdown: 0.07 * quintile, loss: 0.02 * quintile }));
    expect(quintileRow(rows, 5)?.drawdown).toBeCloseTo(0.35, 10);
    expect(quintileRow(rows, 6)).toBeNull();
  });
});

describe("range helpers", () => {
  it("measures bounds against the price", () => {
    expect(rangeOffset(100, 93.4)).toBeCloseTo(-0.066, 10);
    expect(rangeOffset(0, 1)).toBeNull();
    expect(rangeOffset(null, 1)).toBeNull();
  });

  it("scales an annualized volatility to the horizon", () => {
    expect(horizonMove(0.32, 10)).toBeCloseTo(0.32 * Math.sqrt(10 / 252), 12);
    expect(horizonMove(null, 10)).toBeNull();
    expect(horizonMove(-0.1, 10)).toBeNull();
  });

  it("lays out both bands and the price on a padded linear axis", () => {
    const layout = bandLayout(100, { low: 93, high: 107.5 }, { low: 87, high: 115 }, 0.08);
    expect(layout).toEqual({ outer: { left: 6.9, width: 86.2 }, inner: { left: 25.37, width: 44.64 }, marker: 46.92 });
  });

  it("refuses missing, empty or inconsistent ranges", () => {
    expect(bandLayout(100, null, { low: 87, high: 115 })).toBeNull();
    expect(bandLayout(100, { low: 100, high: 100 }, { low: 100, high: 100 })).toBeNull();
    expect(bandLayout(120, { low: 93, high: 107.5 }, { low: 87, high: 115 })).toBeNull();
    expect(bandLayout(100, { low: 80, high: 107.5 }, { low: 87, high: 115 })).toBeNull();
    expect(bandLayout(null, { low: 93, high: 107.5 }, { low: 87, high: 115 })).toBeNull();
  });
});

describe("exchange calendar", () => {
  it("reads dates in New York time", () => {
    expect(exchangeDate("2026-11-19T21:00:00.000Z")).toBe("2026-11-19");
    // 22:00 in New York on the 19th.
    expect(exchangeDate("2026-11-20T03:00:00Z")).toBe("2026-11-19");
    expect(exchangeDate(null)).toBeNull();
    expect(exchangeDate("not a date")).toBeNull();
  });

  it("counts weekdays after the first date up to and including the second", () => {
    // 2026-11-06 is a Friday.
    expect(weekdaysBetween("2026-11-06", "2026-11-09")).toBe(1);
    expect(weekdaysBetween("2026-11-06", "2026-11-20")).toBe(10);
    expect(weekdaysBetween("2026-11-07", "2026-11-08")).toBe(0);
    expect(weekdaysBetween("2026-11-06", "2026-11-06")).toBe(0);
    expect(weekdaysBetween("2026-11-06", "2026-11-01")).toBe(0);
    // 2026 has 261 weekdays; 1 January (a Thursday) is excluded.
    expect(weekdaysBetween("2026-01-01", "2026-12-31")).toBe(260);
  });
});

describe("reportWithinHorizon", () => {
  const CLOSE = "2026-11-06T00:00:00.000Z";
  const SATURDAY = Date.parse("2026-11-07T15:00:00Z");

  it("flags a report within the next ten sessions of the reference close", () => {
    expect(reportWithinHorizon("2026-11-19T21:00:00Z", CLOSE, 10, SATURDAY)).toBe(true);
    expect(reportWithinHorizon("2026-11-20T13:00:00Z", CLOSE, 10, SATURDAY)).toBe(true);
    expect(reportWithinHorizon("2026-11-23T13:00:00Z", CLOSE, 10, SATURDAY)).toBe(false);
  });

  it("ignores past and missing dates", () => {
    expect(reportWithinHorizon("2026-11-05T21:00:00Z", CLOSE, 10, SATURDAY)).toBe(false);
    expect(reportWithinHorizon(null, CLOSE, 10, SATURDAY)).toBe(false);
  });

  it("counts a report after the reference close on the same day, and starts from today without a close", () => {
    const fridayEvening = Date.parse("2026-11-07T00:30:00Z");
    expect(reportWithinHorizon("2026-11-06T21:05:00Z", CLOSE, 10, fridayEvening)).toBe(true);
    expect(reportWithinHorizon("2026-11-19T21:00:00Z", null, 10, SATURDAY)).toBe(true);
  });
});
