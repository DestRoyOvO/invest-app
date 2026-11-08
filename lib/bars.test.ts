import { describe, expect, it } from "vitest";

import {
  foldTrailingSession,
  latestSessions,
  localDay,
  normalizeBars,
  normalizeDividends,
  normalizeIntradayBars,
  normalizeSplits,
  regularPeriods,
  rollingWindow,
  sessionClassifier,
  sessionDate,
  toMs,
  tradesAroundTheClock,
  type RawChart,
} from "./bars";

const EST = -18_000;
const utc = (iso: string) => Date.parse(iso);

describe("normalizeBars", () => {
  it("returns an empty list for missing data", () => {
    expect(normalizeBars(null)).toEqual([]);
    expect(normalizeBars({})).toEqual([]);
  });

  it("maps rows to the exchange session date and keeps adjusted closes", () => {
    const bars = normalizeBars({
      meta: { gmtoffset: EST },
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

  it("keeps monthly bars stamped at local midnight on their date across a daylight-saving change", () => {
    // October 1 00:00 New York time is 04:00Z (EDT), but Yahoo's gmtoffset is today's EST offset of -5 hours.
    const bars = normalizeBars({
      meta: { gmtoffset: EST },
      quotes: [
        { date: new Date("2026-10-01T04:00:00Z"), open: 330, high: 351, low: 325, close: 344 },
        { date: new Date("2026-11-01T04:00:00Z"), open: 342, high: 355, low: 325, close: 342 },
      ],
    });
    expect(bars.map((b) => new Date(b.t).toISOString().slice(0, 10))).toEqual(["2026-10-01", "2026-11-01"]);
  });
});

describe("toMs and sessionDate", () => {
  it("reads Dates, ISO strings, epoch seconds, epoch milliseconds and raw wrappers", () => {
    const ms = utc("2026-11-06T14:30:00Z");
    expect(toMs(new Date(ms))).toBe(ms);
    expect(toMs("2026-11-06T14:30:00Z")).toBe(ms);
    expect(toMs(ms / 1000)).toBe(ms);
    expect(toMs(ms)).toBe(ms);
    expect(toMs({ raw: ms / 1000 })).toBe(ms);
    expect(toMs("nope")).toBeNull();
    expect(toMs(null)).toBeNull();
  });

  it("rounds a time just before local midnight to the next day only", () => {
    expect(sessionDate(utc("2026-11-06T14:30:00Z"), EST)).toBe(Date.UTC(2026, 10, 6));
    expect(sessionDate(utc("2026-11-02T04:00:00Z"), EST)).toBe(Date.UTC(2026, 10, 2)); // 23:00 local, a DST artifact
    expect(sessionDate(utc("2026-11-02T02:00:00Z"), EST)).toBe(Date.UTC(2026, 10, 1)); // 21:00 local, still Nov 1
    expect(localDay(utc("2026-11-06T14:30:00Z"), EST)).toBe(Date.UTC(2026, 10, 6) / 86_400_000);
  });
});

describe("foldTrailingSession", () => {
  const bar = (date: string, o: number, h: number, l: number, c: number) => ({ t: Date.parse(`${date}T00:00:00Z`), o, h, l, c, adjClose: c, v: 100 });

  it("folds the latest session row into its month", () => {
    const bars = [bar("2026-10-01", 330, 351, 325, 344), bar("2026-11-01", 342, 355, 325, 341), bar("2026-11-06", 338, 357, 338, 342.37)];
    const folded = foldTrailingSession(bars, "1mo");
    expect(folded).toHaveLength(2);
    expect(folded[1]).toMatchObject({ t: Date.parse("2026-11-01T00:00:00Z"), o: 342, h: 357, l: 325, c: 342.37, adjClose: 342.37, v: 100 });
  });

  it("folds into the week that starts on Monday and leaves complete periods alone", () => {
    const weekly = [bar("2026-10-26", 344, 351, 334, 344), bar("2026-11-02", 342, 355, 325, 342), bar("2026-11-06", 338, 345, 338, 342)];
    expect(foldTrailingSession(weekly, "1wk")).toHaveLength(2);
    const complete = [bar("2026-10-26", 344, 351, 334, 344), bar("2026-11-02", 342, 355, 325, 342)];
    expect(foldTrailingSession(complete, "1wk")).toEqual(complete);
    expect(foldTrailingSession([bar("2026-11-02", 1, 1, 1, 1)], "1mo")).toHaveLength(1);
  });
});

// A New York intraday fixture in the shape yahoo-finance2 returns with validation off: tradingPeriods as
// { pre, regular, post } with Date values, 5-minute rows from pre-market to after hours, and a last-trade row.
function nyChart(): RawChart {
  const day = (d: string) => ({
    pre: { start: new Date(`${d}T09:00:00Z`), end: new Date(`${d}T14:30:00Z`) },
    regular: { start: new Date(`${d}T14:30:00Z`), end: new Date(`${d}T21:00:00Z`) },
    post: { start: new Date(`${d}T21:00:00Z`), end: new Date(`${d}T01:00:00Z`) },
  });
  const days = [day("2026-11-05"), day("2026-11-06")];
  const row = (iso: string, close: number) => ({ date: new Date(iso), open: close, high: close + 0.5, low: close - 0.5, close, volume: 10 });
  return {
    meta: {
      gmtoffset: EST,
      exchangeTimezoneName: "America/New_York",
      currentTradingPeriod: days[1],
      tradingPeriods: {
        pre: days.map((d) => [d.pre]),
        regular: days.map((d) => [d.regular]),
        post: days.map((d) => [d.post]),
      },
    },
    quotes: [
      row("2026-11-05T14:00:00Z", 99), // pre
      row("2026-11-05T14:30:00Z", 100), // regular open
      row("2026-11-05T20:55:00Z", 101), // last regular bar
      row("2026-11-05T21:00:00Z", 101.5), // post
      row("2026-11-06T09:05:00Z", 102), // pre
      row("2026-11-06T14:30:00Z", 103),
      { date: new Date("2026-11-06T15:00:00Z"), open: null, high: 1, low: 1, close: 1 }, // dropped
      row("2026-11-06T20:55:00Z", 104),
      row("2026-11-07T00:59:43Z", 104.4), // the latest trade after hours, off the 5-minute grid
    ],
  };
}

describe("intraday sessions", () => {
  it("reads regular periods in both of Yahoo's shapes", () => {
    expect(regularPeriods(nyChart().meta)).toHaveLength(2);
    const hk = {
      tradingPeriods: [
        [{ timezone: "HKT", start: utc("2026-11-05T01:30:00Z") / 1000, end: utc("2026-11-05T08:10:00Z") / 1000, gmtoffset: 28_800 }],
        [{ timezone: "HKT", start: utc("2026-11-06T01:30:00Z") / 1000, end: utc("2026-11-06T08:10:00Z") / 1000, gmtoffset: 28_800 }],
      ],
    };
    expect(regularPeriods(hk)).toEqual([
      { start: utc("2026-11-05T01:30:00Z"), end: utc("2026-11-05T08:10:00Z") },
      { start: utc("2026-11-06T01:30:00Z"), end: utc("2026-11-06T08:10:00Z") },
    ]);
    expect(regularPeriods(undefined)).toEqual([]);
  });

  it("normalizes intraday rows with their timestamps and sessions", () => {
    const bars = normalizeIntradayBars(nyChart());
    expect(bars.map((b) => [new Date(b.t).toISOString().slice(5, 16), b.session])).toEqual([
      ["11-05T14:00", "pre"],
      ["11-05T14:30", "regular"],
      ["11-05T20:55", "regular"],
      ["11-05T21:00", "post"],
      ["11-06T09:05", "pre"],
      ["11-06T14:30", "regular"],
      ["11-06T20:55", "regular"],
      ["11-07T00:59", "post"],
    ]);
  });

  it("falls back to the current session's hours for days without trading periods", () => {
    const classify = sessionClassifier({
      gmtoffset: EST,
      currentTradingPeriod: { regular: { start: new Date("2026-11-06T14:30:00Z"), end: new Date("2026-11-06T21:00:00Z") } },
    });
    expect(classify(utc("2026-11-04T13:00:00Z"))).toBe("pre");
    expect(classify(utc("2026-11-04T16:00:00Z"))).toBe("regular");
    expect(classify(utc("2026-11-04T22:00:00Z"))).toBe("post");
    expect(sessionClassifier(undefined)(utc("2026-11-04T22:00:00Z"))).toBe("regular");
  });

  it("keeps the latest sessions with regular bars plus any later pre-market, and the close before them", () => {
    const bars = normalizeIntradayBars(nyChart());
    const one = latestSessions(bars, 1, EST);
    expect(one.bars.map((b) => b.c)).toEqual([102, 103, 104, 104.4]);
    expect(one.previousClose).toBe(101);

    const two = latestSessions(bars, 5, EST);
    expect(two.bars).toHaveLength(bars.length);
    expect(two.previousClose).toBeNull();

    // Monday's pre-market before the open: the last regular session (Friday) stays, with Monday's early bars after it.
    const premarket = latestSessions(
      [
        { t: utc("2026-11-06T20:55:00Z"), c: 104, session: "regular" as const },
        { t: utc("2026-11-09T12:00:00Z"), c: 105, session: "pre" as const },
      ],
      1,
      EST,
    );
    expect(premarket.bars.map((b) => b.c)).toEqual([104, 105]);
    expect(latestSessions([], 1, EST)).toEqual({ bars: [], previousClose: null });
  });
});

describe("round-the-clock markets", () => {
  it("recognizes a regular period of 23 hours or more", () => {
    const crypto = { currentTradingPeriod: { regular: { start: new Date("2026-11-07T00:00:00Z"), end: new Date("2026-11-07T23:59:00Z") } } };
    expect(tradesAroundTheClock(crypto)).toBe(true);
    expect(tradesAroundTheClock(nyChart().meta)).toBe(false);
    expect(tradesAroundTheClock(undefined)).toBe(false);
  });

  it("keeps the last 24 hours with the close just before them", () => {
    const hour = 3_600_000;
    const start = utc("2026-11-06T00:00:00Z");
    const bars = Array.from({ length: 30 }, (_, i) => ({ t: start + i * hour, c: 100 + i }));
    const day = rollingWindow(bars, 1);
    expect(day.bars).toHaveLength(24);
    expect(day.bars[0].c).toBe(106);
    expect(day.previousClose).toBe(105);
    expect(rollingWindow(bars, 5).bars).toHaveLength(30);
    expect(rollingWindow(bars, 5).previousClose).toBeNull();
    expect(rollingWindow([], 1)).toEqual({ bars: [], previousClose: null });
  });
});

describe("events", () => {
  const chart: RawChart = {
    meta: { gmtoffset: EST },
    events: {
      dividends: [
        { amount: 0.27, date: new Date("2026-08-10T13:30:00Z") },
        { amount: 0.26, date: new Date("2026-05-11T13:30:00Z") },
        { amount: 0, date: new Date("2026-02-09T14:30:00Z") },
      ],
      splits: { "1598880600": { date: 1_598_880_600, numerator: 4, denominator: 1, splitRatio: "4:1" } },
    },
  };

  it("maps dividends to session dates, oldest first, dropping empty amounts", () => {
    expect(normalizeDividends(chart)).toEqual([
      { t: Date.UTC(2026, 4, 11), amount: 0.26 },
      { t: Date.UTC(2026, 7, 10), amount: 0.27 },
    ]);
    expect(normalizeDividends(chart, true)[0].t).toBe(utc("2026-05-11T13:30:00Z"));
    expect(normalizeDividends({})).toEqual([]);
  });

  it("reads splits from Yahoo's object form", () => {
    expect(normalizeSplits(chart)).toEqual([{ t: Date.UTC(2020, 7, 31), numerator: 4, denominator: 1, ratio: "4:1" }]);
    expect(normalizeSplits({ events: { splits: [{ date: "2014-06-09T13:30:00Z", numerator: 7, denominator: 1 }] } })[0].ratio).toBe("7:1");
  });
});
