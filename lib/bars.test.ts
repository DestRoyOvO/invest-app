import { describe, expect, it } from "vitest";

import { normalizeBars } from "./bars";

describe("normalizeBars", () => {
  it("returns an empty list for missing data", () => {
    expect(normalizeBars(null)).toEqual([]);
    expect(normalizeBars({})).toEqual([]);
  });

  it("maps rows to the exchange session date and keeps adjusted closes", () => {
    const bars = normalizeBars({
      meta: { gmtoffset: -18000 },
      quotes: [
        { date: new Date("2026-11-05T14:30:00Z"), open: 10, high: 11, low: 9, close: 10.5, adjclose: 10.4, volume: 1000 },
        { date: "2026-11-06T14:30:00.000Z", open: 10.5, high: 12, low: 10, close: 11, volume: null },
      ],
    });
    expect(bars).toEqual([
      { t: Date.UTC(2026, 10, 5), o: 10, h: 11, l: 9, c: 10.5, adjClose: 10.4, v: 1000 },
      { t: Date.UTC(2026, 10, 6), o: 10.5, h: 12, l: 10, c: 11, adjClose: 11, v: null },
    ]);
  });

  it("drops invalid rows and keeps the latest row for a repeated date", () => {
    const bars = normalizeBars({
      quotes: [
        { date: "2026-11-05T14:30:00Z", open: null, high: 11, low: 9, close: 10 },
        { date: "2026-11-05T14:30:00Z", open: 10, high: 11, low: 9, close: 0 },
        { date: "not a date", open: 10, high: 11, low: 9, close: 10 },
        { date: "2026-11-06T14:30:00Z", open: 10, high: 11, low: 9, close: 10 },
        { date: "2026-11-06T20:00:00Z", open: 10, high: 12, low: 9, close: 11.5 },
      ],
    });
    expect(bars).toHaveLength(1);
    expect(bars[0].c).toBe(11.5);
  });
});
