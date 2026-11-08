import { describe, expect, it } from "vitest";

import type { MarketState, OverviewQuote, SectorSnapshot } from "@/types/api";
import type { WorldRow } from "@/types/markets";
import { WORLD_BOARD, WORLD_REGIONS } from "@/lib/universe";

import { changeDistribution } from "./breadth";
import { curveChartGeometry, niceStep, spreadSparkGeometry } from "./curve-chart";
import { dateInZone, groupWorld, localTradeTime, overnightSummary, sessionOf } from "./world";

function row(symbol: string, overrides: Partial<WorldRow> = {}): WorldRow {
  return { symbol, price: 100, change: 1, changePercent: 1, marketState: "CLOSED", time: null, spark: [], stale: false, ...overrides };
}

describe("sessionOf", () => {
  it("maps Yahoo's states to four words", () => {
    const states: Array<[MarketState | null, string]> = [
      ["REGULAR", "open"],
      ["PRE", "pre"],
      ["PREPRE", "pre"],
      ["POST", "post"],
      ["POSTPOST", "post"],
      ["CLOSED", "closed"],
      [null, "unknown"],
    ];
    for (const [state, kind] of states) expect(sessionOf(state)).toBe(kind);
  });
});

describe("groupWorld", () => {
  it("lists every instrument by region and keeps a null row for missing quotes", () => {
    const groups = groupWorld([row("^GSPC"), row("^N225"), row("BTC-USD")]);
    expect(groups.map((g) => g.region)).toEqual([...WORLD_REGIONS]);
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(WORLD_BOARD.length);
    const americas = groups[0].entries;
    expect(americas[0].def.symbol).toBe("^GSPC");
    expect(americas[0].row?.symbol).toBe("^GSPC");
    expect(americas[1].row).toBeNull();
    expect(groups.find((g) => g.region === "crypto")?.entries.map((e) => e.def.code)).toEqual(["BTC", "ETH"]);
  });
});

describe("localTradeTime", () => {
  // Nikkei close on Friday 2026-11-06 at 15:45 in Tokyo.
  const close = "2026-11-06T06:45:02.000Z";

  it("shows the time alone when the trade was today on the exchange's clock", () => {
    const sameDay = Date.parse("2026-11-06T09:00:00Z"); // 18:00 in Tokyo
    expect(localTradeTime(close, "Asia/Tokyo", "en", sameDay)).toBe("15:45");
  });

  it("adds the weekday for an earlier day, in the reader's language", () => {
    const nextDay = Date.parse("2026-11-07T01:00:00Z"); // Saturday 10:00 in Tokyo
    expect(localTradeTime(close, "Asia/Tokyo", "en", nextDay)).toBe("Fri 15:45");
    expect(localTradeTime(close, "Asia/Tokyo", "zh", nextDay)).toBe("周五 15:45");
  });

  it("follows the exchange's date, not UTC", () => {
    // 22:30 New York on Friday is already Saturday in UTC.
    expect(dateInZone(Date.parse("2026-11-07T03:30:00Z"), "America/New_York")).toBe("2026-11-06");
    expect(localTradeTime("2026-11-06T21:00:00Z", "America/New_York", "en", Date.parse("2026-11-07T03:30:00Z"))).toBe("16:00");
  });

  it("returns a dash without a time", () => {
    expect(localTradeTime(null, "Asia/Tokyo", "en")).toBe("—");
    expect(localTradeTime("not a date", "Asia/Tokyo", "en")).toBe("—");
  });
});

describe("overnightSummary", () => {
  it("lists the Asian and European benchmarks and says whether each region trades", () => {
    const rows = [
      row("^N225", { changePercent: -5.96 }),
      row("^HSI", { changePercent: -1.27 }),
      row("000300.SS", { changePercent: -1.44 }),
      row("^STOXX50E", { changePercent: 0.3, marketState: "REGULAR" }),
      row("^FTSE", { changePercent: 0.1, marketState: "REGULAR" }),
      row("^GSPC", { changePercent: 0.31 }),
    ];
    const groups = overnightSummary(rows);
    expect(groups.map((g) => [g.region, g.live])).toEqual([
      ["asia", false],
      ["europe", true],
    ]);
    expect(groups[0].items.map((i) => [i.code, i.changePercent])).toEqual([
      ["NKY", -5.96],
      ["HSI", -1.27],
      ["CSI300", -1.44],
    ]);
    expect(groups[1].items.map((i) => i.code)).toEqual(["SX5E", "UKX"]);
  });

  it("leaves out a region without quotes", () => {
    expect(overnightSummary([row("^N225")]).map((g) => g.region)).toEqual(["asia"]);
    expect(overnightSummary([])).toEqual([]);
  });
});

describe("curveChartGeometry", () => {
  const pad = { top: 10, right: 10, bottom: 20, left: 30 };

  it("spaces tenors evenly and frames every yield with round gridlines", () => {
    const geometry = curveChartGeometry(
      [
        [4.02, 4.19, 4.51, 4.86, 5.26],
        [4.06, 4.21, 4.79, 5.27, 5.64],
      ],
      330,
      130,
      pad,
    );
    expect(geometry.xs).toEqual([30, 102.5, 175, 247.5, 320]);
    const ticks = geometry.yTicks.map((tick) => tick.value);
    expect(ticks[0]).toBeLessThanOrEqual(4.02);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(5.64);
    expect(ticks.length).toBeLessThanOrEqual(7);
    expect(geometry.yTicks[0].y).toBe(110);
    expect(geometry.yTicks[ticks.length - 1].y).toBe(10);
    expect(geometry.paths[0].startsWith("M30,")).toBe(true);
    expect(geometry.paths[0].split("L")).toHaveLength(5);
  });

  it("breaks a line where a yield is missing", () => {
    const geometry = curveChartGeometry([[4, null, 4.2, 4.3]], 100, 50, pad);
    expect(geometry.points[0][1]).toBeNull();
    expect(geometry.paths[0].match(/M/g)).toHaveLength(2);
  });

  it("copes with no data", () => {
    const geometry = curveChartGeometry([[null, null]], 100, 50, pad);
    expect(geometry.yTicks).toEqual([]);
    expect(geometry.paths).toEqual([""]);
  });

  it("picks round steps", () => {
    expect(niceStep(0.3)).toBe(0.1);
    expect(niceStep(1.6)).toBe(0.5);
    expect(niceStep(4)).toBe(1);
    expect(niceStep(0.12)).toBe(0.05);
  });
});

describe("spreadSparkGeometry", () => {
  it("includes zero so the distance from inversion shows", () => {
    const geometry = spreadSparkGeometry([40, 50, 35], 100, 26);
    expect(geometry.zeroY).toBe(23);
    expect(geometry.end).toEqual({ x: 97, y: geometry.end?.y });
    expect(geometry.path.split("L")).toHaveLength(3);
  });

  it("puts the zero line inside a range that crosses it", () => {
    const geometry = spreadSparkGeometry([-20, 20], 100, 26);
    expect(geometry.zeroY).toBe(13);
  });

  it("needs two points", () => {
    expect(spreadSparkGeometry([5], 100, 26)).toEqual({ path: "", zeroY: null, end: null });
  });
});

describe("changeDistribution", () => {
  function quote(symbol: string, changePercent: number | null): OverviewQuote {
    return {
      symbol,
      name: symbol,
      price: 1,
      change: null,
      changePercent,
      volume: null,
      avgVolume: null,
      marketCap: null,
      trailingPE: null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
    };
  }

  it("counts stocks per heat step, leaving out missing changes", () => {
    const sectors: SectorSnapshot[] = [
      { key: "technology", changePercent: 1, stocks: [quote("A", 11), quote("B", 0.05), quote("C", -0.8), quote("D", null)] },
      { key: "energy", changePercent: 0, stocks: [quote("E", -4), quote("F", 0.5)] },
    ];
    const bins = changeDistribution(sectors);
    expect(bins.map((bin) => bin.step)).toEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4]);
    expect(bins.map((bin) => bin.count)).toEqual([1, 0, 1, 0, 1, 1, 0, 0, 1]);
  });
});
