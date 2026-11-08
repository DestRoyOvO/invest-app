import { describe, expect, it } from "vitest";

import type { Bar } from "@/types/api";

import {
  barIndexAt,
  bollingerSeries,
  carriesVolume,
  chartTime,
  compareSlots,
  dataRange,
  historyRangeFor,
  offscreenLevels,
  percentChange,
  RANGES,
  sessionBaselines,
  sharesSession,
  smaSeries,
  stepRange,
  tickDecimals,
  tickDigits,
  visibleBars,
  windowStart,
  zoneOffsetSeconds,
} from "./chart-utils";

describe("ranges", () => {
  it("shares one two-year request across the daily views and keeps the others", () => {
    expect(["1mo", "3mo", "6mo", "ytd", "1y", "2y"].map((r) => dataRange(r as never))).toEqual(Array(6).fill("2y"));
    expect(dataRange("1d")).toBe("1d");
    expect(dataRange("5d")).toBe("5d");
    expect(dataRange("5y")).toBe("5y");
    expect(dataRange("max")).toBe("max");
  });

  it("compares on adjusted history from six months to five years only", () => {
    expect(historyRangeFor("1mo")).toBeNull();
    expect(historyRangeFor("3mo")).toBeNull();
    expect(historyRangeFor("6mo")).toBe("2y");
    expect(historyRangeFor("ytd")).toBe("2y");
    expect(historyRangeFor("5y")).toBe("5y");
    expect(historyRangeFor("max")).toBeNull();
    expect(historyRangeFor("1d")).toBeNull();
  });

  it("windows the shared data by calendar months from the last bar", () => {
    const last = Date.UTC(2026, 10, 6);
    expect(windowStart("1mo", last)).toBe(Date.UTC(2026, 9, 6));
    expect(windowStart("3mo", last)).toBe(Date.UTC(2026, 7, 6));
    expect(windowStart("6mo", last)).toBe(Date.UTC(2026, 4, 6));
    expect(windowStart("ytd", last)).toBe(Date.UTC(2026, 0, 1));
    expect(windowStart("1y", last)).toBe(Date.UTC(2025, 10, 6));
    expect(windowStart("2y", last)).toBeNull();
    expect(windowStart("1d", last)).toBeNull();
  });

  it("steps through the ranges and stops at the ends", () => {
    expect(stepRange("1y", 1)).toBe("2y");
    expect(stepRange("1y", -1)).toBe("ytd");
    expect(stepRange("1d", -1)).toBe("1d");
    expect(stepRange("max", 1)).toBe("max");
    expect(RANGES).toHaveLength(10);
  });

  it("keeps comparison colors apart from the quote's own line in every convention", () => {
    expect(compareSlots(false).map((slot) => slot.token)).toEqual([1, 2, 3]);
    expect(compareSlots(false)[1].dashed).toBe(true);
    expect(compareSlots(true).map((slot) => slot.token)).toEqual([2, 3, 4]);
    expect(compareSlots(true).some((slot) => slot.dashed)).toBe(false);
  });

  it("drops extended-hours bars unless asked to keep them", () => {
    const bars: Bar[] = [
      { t: 1, o: 1, h: 1, l: 1, c: 1, v: 0, session: "pre" },
      { t: 2, o: 1, h: 1, l: 1, c: 1, v: 9, session: "regular" },
      { t: 3, o: 1, h: 1, l: 1, c: 1, v: 0, session: "post" },
      { t: 4, o: 1, h: 1, l: 1, c: 1, v: 9 },
    ];
    expect(visibleBars(bars, false).map((b) => b.t)).toEqual([2, 4]);
    expect(visibleBars(bars, true)).toHaveLength(4);
  });

  it("finds volume only where some bar of the latest year carries it", () => {
    const bar = (v: number | null, t = 1): Bar => ({ t, o: 1, h: 1, l: 1, c: 1, v });
    // ^TNX and EURUSD=X: zeros throughout; nulls where Yahoo leaves the field out.
    expect(carriesVolume([bar(0), bar(0), bar(0)])).toBe(false);
    expect(carriesVolume([bar(null), bar(0)])).toBe(false);
    expect(carriesVolume([])).toBe(false);
    // BTC-USD intraday: volume on some five-minute bars only.
    expect(carriesVolume([bar(0), bar(0), bar(1_250_000), bar(0)])).toBe(true);
    // ^TNX MAX: monthly bars with volume in 2005 and none since.
    const month = (iso: string, v: number) => bar(v, Date.parse(`${iso}-01T00:00:00Z`));
    expect(carriesVolume([month("2005-02", 2_959_200), month("2005-03", 2_007_800), month("2025-12", 0), month("2026-11", 0)])).toBe(false);
    expect(carriesVolume([month("2005-02", 2_959_200), month("2026-01", 1_000), month("2026-11", 0)])).toBe(true);
  });
});

describe("studies", () => {
  it("averages over the period and leaves the warm-up empty", () => {
    expect(smaSeries([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(smaSeries([1, 2], 3)).toEqual([null, null]);
  });

  it("puts Bollinger bands k population standard deviations around the average", () => {
    const { upper, lower } = bollingerSeries([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    // Mean 5, population standard deviation 2.
    expect(upper.at(-1)).toBeCloseTo(9);
    expect(lower.at(-1)).toBeCloseTo(1);
    expect(upper.slice(0, 7).every((v) => v === null)).toBe(true);
    const flat = bollingerSeries([3, 3, 3], 3, 2);
    expect(flat.upper[2]).toBe(3);
  });

  it("measures percent change from a positive base only", () => {
    expect(percentChange(100, 112.5)).toBeCloseTo(12.5);
    expect(percentChange(100, 90)).toBeCloseTo(-10);
    expect(percentChange(0, 5)).toBeNull();
    expect(percentChange(null, 5)).toBeNull();
  });
});

describe("time", () => {
  it("reads the zone offset at the instant, across daylight saving", () => {
    expect(zoneOffsetSeconds(Date.UTC(2026, 6, 1, 15), "America/New_York")).toBe(-4 * 3600);
    expect(zoneOffsetSeconds(Date.UTC(2026, 11, 1, 15), "America/New_York")).toBe(-5 * 3600);
    expect(zoneOffsetSeconds(Date.UTC(2026, 11, 1, 15), "Asia/Hong_Kong")).toBe(8 * 3600);
    expect(zoneOffsetSeconds(Date.UTC(2026, 11, 1, 15), null)).toBe(0);
    expect(zoneOffsetSeconds(Date.UTC(2026, 11, 1, 15), "Not/AZone")).toBe(0);
  });

  it("shifts intraday bars to exchange time and leaves session dates alone", () => {
    const open = Date.UTC(2026, 10, 6, 14, 30); // 09:30 in New York
    expect(chartTime(open, true, "America/New_York")).toBe(Date.UTC(2026, 10, 6, 9, 30) / 1000);
    expect(chartTime(Date.UTC(2026, 10, 6), false, "America/New_York")).toBe(Date.UTC(2026, 10, 6) / 1000);
  });

  it("measures intraday bars from the previous session's regular close", () => {
    const at = (iso: string, c: number, session: Bar["session"]): Bar => ({ t: Date.parse(iso), o: c, h: c, l: c, c, v: 0, session });
    const bars = [
      at("2026-11-05T14:30:00Z", 100, "regular"),
      at("2026-11-05T20:55:00Z", 101, "regular"),
      at("2026-11-05T22:00:00Z", 102, "post"),
      at("2026-11-06T12:00:00Z", 103, "pre"),
      at("2026-11-06T14:30:00Z", 104, "regular"),
      at("2026-11-09T12:00:00Z", 105, "pre"),
    ];
    expect(sessionBaselines(bars, 99, "America/New_York")).toEqual([99, 99, 99, 101, 101, 104]);
    expect(sessionBaselines([], 99, "America/New_York")).toEqual([]);
  });

  it("finds the bar that contains an event", () => {
    const times = [10, 20, 30, 40];
    expect(barIndexAt(times, 25)).toBe(1);
    expect(barIndexAt(times, 40)).toBe(3);
    expect(barIndexAt(times, 99)).toBe(3);
    expect(barIndexAt(times, 5)).toBe(-1);
    expect(barIndexAt([], 5)).toBe(-1);
  });
});

describe("tickDecimals", () => {
  it("drops decimals on whole ticks and keeps just enough otherwise", () => {
    expect(tickDecimals([160, 180, 200, 220, 240])).toBe(0);
    expect(tickDecimals([182.5, 185, 187.5])).toBe(1);
    expect(tickDecimals([0.25, 0.5, 0.75])).toBe(2);
    expect(tickDecimals([0.1234, 0.1236])).toBe(4);
    expect(tickDecimals([])).toBe(2);
  });
});

describe("tickDigits", () => {
  it("shares one count on an ordinary axis and gives each tick its own across decades", () => {
    expect(tickDigits([180, 182.5, 185], 2)).toEqual([1, 1, 1]);
    expect(tickDigits([0.1234, 0.1236], 2)).toEqual([2, 2]);
    expect(tickDigits([600, 60, 6, 0.6, 0.06], 2)).toEqual([0, 0, 0, 1, 2]);
    expect(tickDigits([], 2)).toEqual([]);
  });
});

describe("comparisons and levels", () => {
  it("tells sessions that trade at the same time from ones that never overlap", () => {
    const hk = [Date.parse("2026-11-06T01:30:00Z"), Date.parse("2026-11-06T07:55:00Z")];
    const ny = [Date.parse("2026-11-06T14:30:00Z"), Date.parse("2026-11-06T20:55:00Z")];
    const london = [Date.parse("2026-11-06T08:00:00Z"), Date.parse("2026-11-06T14:30:00Z")];
    expect(sharesSession(hk, ny)).toBe(false);
    expect(sharesSession(ny, london)).toBe(true);
    expect(sharesSession(ny, [])).toBe(false);
  });

  it("names the levels beyond a quarter of the visible price span, with their side", () => {
    const levels = [
      { key: "cost" as const, price: 118.5 },
      { key: "target" as const, price: 240 },
      { key: "stop" as const, price: 165 },
    ];
    // Prices 164 to 243 (span 79): the cost is more than 19.75 below the low, the others are within reach.
    expect(offscreenLevels(levels, 164.27, 243.37)).toEqual([{ key: "cost", price: 118.5, side: "below" }]);
    expect(offscreenLevels([{ key: "target", price: 400 }, { key: "stop", price: null }, { key: "cost", price: 0 }], 100, 200)).toEqual([
      { key: "target", price: 400, side: "above" },
    ]);
    expect(offscreenLevels(levels, null, 200)).toEqual([]);
  });
});
