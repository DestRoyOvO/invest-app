import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clearCache } from "./cache";
import { CHART_RANGES, getChart, getQuotes, yf } from "./yahoo";

// getChart (the chart region of yahoo.ts) against a fake yf.chart returning rows in the shape yahoo-finance2 gives
// with validation off: Dates for times, tradingPeriods as { pre, regular, post }, events as arrays.

const NOW = Date.parse("2026-11-07T15:00:00Z"); // a Saturday
const EST = -18_000;

function spyChart(...results: unknown[]) {
  const spy = vi.spyOn(yf, "chart");
  for (const result of results) {
    if (result instanceof Error) spy.mockRejectedValueOnce(result);
    else spy.mockResolvedValueOnce(result as never);
  }
  return spy;
}

/** The query object of a recorded yf.chart call. */
function queryOf(spy: ReturnType<typeof spyChart>, call = 0): Record<string, unknown> {
  return (spy.mock.calls[call] as unknown[])[1] as Record<string, unknown>;
}

const row = (iso: string, close: number, volume = 10, open = close) => ({ date: new Date(iso), open, high: close + 0.5, low: close - 0.5, close, volume });

function nyDay(d: string, next: string) {
  return {
    pre: { start: new Date(`${d}T09:00:00Z`), end: new Date(`${d}T14:30:00Z`) },
    regular: { start: new Date(`${d}T14:30:00Z`), end: new Date(`${d}T21:00:00Z`) },
    post: { start: new Date(`${d}T21:00:00Z`), end: new Date(`${next}T01:00:00Z`) },
  };
}

function nyIntraday(quotes: unknown[]) {
  const days = [nyDay("2026-11-05", "2026-11-06"), nyDay("2026-11-06", "2026-11-07")];
  return {
    meta: {
      gmtoffset: EST,
      exchangeTimezoneName: "America/New_York",
      previousClose: 99,
      currentTradingPeriod: days[1],
      tradingPeriods: { pre: days.map((d) => [d.pre]), regular: days.map((d) => [d.regular]), post: days.map((d) => [d.post]) },
    },
    quotes,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  clearCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearCache();
});

describe("getChart: intraday", () => {
  it("offers the ten chart ranges", () => {
    expect(CHART_RANGES).toEqual(["1d", "5d", "1mo", "3mo", "6mo", "ytd", "1y", "2y", "5y", "max"]);
  });

  it("loads 1D as 5-minute bars with extended hours and events, keeps the latest session and folds the last-trade row", async () => {
    const spy = spyChart(
      nyIntraday([
        row("2026-11-05T14:30:00Z", 100),
        row("2026-11-05T20:55:00Z", 101),
        row("2026-11-06T09:00:00Z", 102), // pre-market
        row("2026-11-06T14:30:00Z", 103),
        row("2026-11-06T20:55:00Z", 104),
        row("2026-11-06T21:00:00Z", 104.2), // after hours
        row("2026-11-07T00:55:00Z", 104.3, 7, 104.25),
        { date: new Date("2026-11-07T00:59:59Z"), open: 104.4, high: 104.4, low: 104.4, close: 104.4, volume: 0 }, // last trade, off the grid
      ]),
    );
    const chart = await getChart("CHART1D", "1d");

    expect(spy).toHaveBeenCalledTimes(1);
    const [symbol, , options] = spy.mock.calls[0] as unknown[];
    expect(symbol).toBe("CHART1D");
    expect(queryOf(spy)).toMatchObject({ interval: "5m", includePrePost: true, events: "div|split" });
    expect((queryOf(spy).period1 as Date).toISOString()).toBe("2026-10-31T15:00:00.000Z");
    expect(options).toMatchObject({ validateResult: false });

    expect(chart).toMatchObject({ symbol: "CHART1D", range: "1d", interval: "5m", intraday: true, continuous: false, timezone: "America/New_York" });
    expect(chart.bars.map((bar) => [new Date(bar.t).toISOString().slice(5, 16), bar.session])).toEqual([
      ["11-06T09:00", "pre"],
      ["11-06T14:30", "regular"],
      ["11-06T20:55", "regular"],
      ["11-06T21:00", "post"],
      ["11-07T00:55", "post"],
    ]);
    // The last-trade row is part of the 00:55 bar: its open stays, its close is the latest trade.
    expect(chart.bars.at(-1)).toMatchObject({ o: 104.25, h: 104.8, c: 104.4, v: 7 });
    // The change baseline is the last regular close before the session shown.
    expect(chart.previousClose).toBe(101);
  });

  it("falls back to Yahoo's previous close when no earlier session is in the data", async () => {
    spyChart(nyIntraday([row("2026-11-06T14:30:00Z", 103), row("2026-11-06T20:55:00Z", 104)]));
    const chart = await getChart("CHARTPC", "1d");
    expect(chart.bars).toHaveLength(2);
    expect(chart.previousClose).toBe(99);
  });

  it("loads 5D as 15-minute bars", async () => {
    const spy = spyChart(nyIntraday([row("2026-11-05T14:30:00Z", 100), row("2026-11-06T14:30:00Z", 103)]));
    const chart = await getChart("CHART5D", "5d");
    expect(queryOf(spy)).toMatchObject({ interval: "15m", includePrePost: true });
    expect(chart.bars).toHaveLength(2);
    expect(chart.previousClose).toBe(99);
  });

  it("keeps intraday bars a minute while the session trades and ten minutes once it has closed", async () => {
    vi.spyOn(yf, "quote").mockResolvedValueOnce([
      { symbol: "TTLOPEN", regularMarketPrice: 10, marketState: "REGULAR" },
      { symbol: "TTLSHUT", regularMarketPrice: 10, marketState: "CLOSED" },
    ] as never);
    await getQuotes(["TTLOPEN", "TTLSHUT"]);
    const intraday = nyIntraday([row("2026-11-06T14:30:00Z", 103)]);
    const spy = spyChart(intraday, intraday, intraday);

    await getChart("TTLOPEN", "1d");
    await getChart("TTLSHUT", "1d");
    vi.setSystemTime(NOW + 2 * 60_000);
    await getChart("TTLOPEN", "1d"); // expired after one minute: loads again
    await getChart("TTLSHUT", "1d"); // still fresh
    expect(spy.mock.calls.map((call) => (call as unknown[])[0])).toEqual(["TTLOPEN", "TTLSHUT", "TTLOPEN"]);
  });
});

describe("getChart: daily and longer", () => {
  it("folds the trailing session row of a weekly chart into its week", async () => {
    const spy = spyChart({
      meta: { gmtoffset: EST, exchangeTimezoneName: "America/New_York" },
      quotes: [
        row("2026-10-26T04:00:00Z", 180), // weeks are stamped at local midnight (EDT here)
        row("2026-11-02T05:00:00Z", 185),
        row("2026-11-06T14:30:00Z", 188, 5, 186), // the latest session, stamped at its open
      ],
    });
    const chart = await getChart("CHART5Y", "5y");
    expect(queryOf(spy)).toMatchObject({ interval: "1wk", includePrePost: false, events: "div|split" });
    expect(chart.intraday).toBe(false);
    expect(chart.bars.map((bar) => new Date(bar.t).toISOString().slice(0, 10))).toEqual(["2026-10-26", "2026-11-02"]);
    expect(chart.bars[1]).toMatchObject({ o: 185, h: 188.5, l: 184.5, c: 188 });
    expect(chart.previousClose).toBeNull();
  });

  it("starts YTD on January 1 and drops anything Yahoo sends from before", async () => {
    const spy = spyChart({
      meta: { gmtoffset: EST },
      quotes: [row("2025-12-31T14:30:00Z", 90), row("2026-01-02T14:30:00Z", 91), row("2026-11-06T14:30:00Z", 120)],
    });
    const chart = await getChart("CHARTYTD", "ytd");
    expect((queryOf(spy).period1 as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(chart.bars.map((bar) => new Date(bar.t).toISOString().slice(0, 10))).toEqual(["2026-01-02", "2026-11-06"]);
  });

  it("asks for monthly bars from the first trade for MAX", async () => {
    const spy = spyChart({ meta: { gmtoffset: EST }, quotes: [row("2026-10-01T04:00:00Z", 100), row("2026-11-01T04:00:00Z", 110)] });
    const chart = await getChart("CHARTMAX", "max");
    expect(queryOf(spy)).toMatchObject({ interval: "1mo" });
    expect((queryOf(spy).period1 as Date).getUTCFullYear()).toBe(1970);
    expect(chart.bars).toHaveLength(2);
  });

  it("keeps dividends and splits inside the bars' span, on their session dates", async () => {
    spyChart({
      meta: { gmtoffset: EST },
      quotes: [row("2025-01-02T14:30:00Z", 50), row("2026-11-06T14:30:00Z", 120)],
      events: {
        dividends: [
          { date: new Date("2024-12-05T14:30:00Z"), amount: 0.01 }, // before the first bar
          { date: new Date("2026-09-04T13:30:00Z"), amount: 0.01 },
        ],
        splits: [{ date: new Date("2024-06-10T13:30:00Z"), numerator: 10, denominator: 1, splitRatio: "10:1" }],
      },
    });
    const chart = await getChart("CHARTEV", "2y");
    expect(chart.dividends).toEqual([{ t: Date.UTC(2026, 8, 4), amount: 0.01 }]);
    expect(chart.splits).toEqual([]);
  });

  it("answers an unknown or delisted symbol with an empty chart and caches it; other errors throw", async () => {
    const spy = spyChart(new Error("No data found, symbol may be delisted"));
    const empty = await getChart("GONE1", "1y");
    expect(empty.bars).toEqual([]);
    expect(empty.dividends).toEqual([]);
    await getChart("GONE1", "1y");
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRejectedValueOnce(new Error("fetch failed"));
    await expect(getChart("DOWN1", "1y")).rejects.toThrow("fetch failed");
  });

  it("keeps daily bars ten minutes", async () => {
    const daily = { meta: { gmtoffset: EST }, quotes: [row("2026-11-06T14:30:00Z", 120)] };
    const spy = spyChart(daily, daily);
    await getChart("DAILY1", "2y");
    vi.setSystemTime(NOW + 9 * 60_000);
    await getChart("DAILY1", "2y");
    expect(spy).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 11 * 60_000);
    await getChart("DAILY1", "2y");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
