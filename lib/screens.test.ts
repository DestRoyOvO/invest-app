import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScreenRow } from "@/types/screener";

import {
  activeFilterChips,
  activePreset,
  applyPreset,
  capParam,
  columnsFor,
  COLUMN_SETS,
  countActiveFilters,
  csvField,
  csvFileName,
  daysUntil,
  defaultScreen,
  DEFAULT_DISCOVER_CAP,
  EMPTY_FILTERS,
  filterRows,
  filtersEqual,
  firstSortDirection,
  formatInputNumber,
  fromInput,
  MAX_SAVED_SCREENS,
  METRICS,
  METRIC_KEYS,
  newYorkDate,
  normalizeFilters,
  normalizeScreen,
  parseCapParam,
  parseNumberInput,
  PHONE_COLUMNS,
  PRESETS,
  presetsFor,
  rangeKeysFor,
  ratingKey,
  relativeVolume,
  removeFilter,
  removeSavedScreen,
  restoreSavedScreen,
  sanitizeSavedScreens,
  screenFromParams,
  screensStore,
  screenToQuery,
  searchParamsFrom,
  sectorCounts,
  setRange,
  sortScreenRows,
  switchUniverse,
  toCsv,
  toInput,
  upsertSavedScreen,
  type FilterContext,
  type SavedScreen,
  type Screen,
  type ScreenFilters,
} from "./screens";

const NOW = Date.parse("2026-11-07T15:00:00Z"); // Saturday, 10:00 in New York

function row(symbol: string, overrides: Partial<ScreenRow> = {}): ScreenRow {
  return {
    symbol,
    name: `${symbol} Inc.`,
    sector: "technology",
    quoteType: "EQUITY",
    price: 100,
    changePercent: 1,
    marketCap: 1e11,
    trailingPE: 20,
    forwardPE: 18,
    priceToBook: 4,
    dividendYield: 0.01,
    analystRating: 2.2,
    nextEarningsDate: null,
    earningsDateEstimated: null,
    fromHigh52: -0.05,
    vs50d: 0.02,
    vs200d: 0.1,
    dollarVolume: 2e9,
    expenseRatio: null,
    netAssets: null,
    ytdReturnPercent: null,
    return1m: 0.03,
    return3m: 0.06,
    return6m: 0.12,
    rsi14: 55,
    technicalScore: 60,
    factors: { momentum: 0.2, reversal: 0.03, high52: 0.95, volatility: 0.25, beta: 1.1 },
    percentiles: { momentum: 50, reversal: 50, high52: 50, volatility: 50, beta: 50 },
    dividendRate: 1,
    exDividendDate: null,
    ...overrides,
  };
}

const NO_LISTS: FilterContext = { watchlist: new Set(), holdings: new Set(), now: NOW };

function filters(overrides: Partial<ScreenFilters>): ScreenFilters {
  return { ...EMPTY_FILTERS, ...overrides };
}

function symbols(rows: ScreenRow[]): string[] {
  return rows.map((r) => r.symbol);
}

describe("metrics and units", () => {
  it("defines a unit, an accessor and at least one universe for every metric", () => {
    for (const key of METRIC_KEYS) {
      expect(METRICS[key].universes.length).toBeGreaterThan(0);
      expect(() => METRICS[key].value(row("X"))).not.toThrow();
    }
  });

  it("offers fund fields to ETFs only and stock fields to stocks only", () => {
    expect(rangeKeysFor("etfs")).toEqual(expect.arrayContaining(["er", "assets", "ytd", "vol", "beta"]));
    expect(rangeKeysFor("etfs")).not.toContain("cap");
    expect(rangeKeysFor("etfs")).not.toContain("rating");
    expect(rangeKeysFor("stocks")).not.toContain("er");
    expect(rangeKeysFor("stocks")).toEqual(expect.arrayContaining(["cap", "pe", "rating", "volPct"]));
  });

  it("converts between raw values and typed numbers without float noise", () => {
    expect(toInput("ratio", 0.07)).toBe(7);
    expect(fromInput("ratio", 7)).toBe(0.07);
    expect(toInput("billions", 1.5e9)).toBe(1.5);
    expect(fromInput("billions", 0.3)).toBe(3e8);
    expect(toInput("multiple", 15)).toBe(15);
    expect(formatInputNumber(toInput("ratio", 0.0009))).toBe("0.09");
    expect(formatInputNumber(-0.1 * 100)).toBe("-10");
  });

  it("parses typed bounds and rejects anything else", () => {
    expect(parseNumberInput("")).toEqual({ kind: "empty" });
    expect(parseNumberInput("   ")).toEqual({ kind: "empty" });
    expect(parseNumberInput("15")).toEqual({ kind: "number", value: 15 });
    expect(parseNumberInput(" -3.5 ")).toEqual({ kind: "number", value: -3.5 });
    expect(parseNumberInput("−20")).toEqual({ kind: "number", value: -20 });
    expect(parseNumberInput("3%")).toEqual({ kind: "number", value: 3 });
    expect(parseNumberInput("$1,200")).toEqual({ kind: "number", value: 1200 });
    expect(parseNumberInput("1.5B")).toEqual({ kind: "number", value: 1.5 });
    expect(parseNumberInput("2 x")).toEqual({ kind: "number", value: 2 });
    expect(parseNumberInput(".5")).toEqual({ kind: "number", value: 0.5 });
    expect(parseNumberInput("abc").kind).toBe("invalid");
    expect(parseNumberInput("-").kind).toBe("invalid");
    expect(parseNumberInput("1..2").kind).toBe("invalid");
    expect(parseNumberInput("%").kind).toBe("invalid");
  });
});

describe("filtering", () => {
  const rows = [
    row("AAA", { sector: "technology", trailingPE: 12, dividendYield: 0.035 }),
    row("BBB", { sector: "energy", trailingPE: 30, dividendYield: 0.04, vs200d: -0.05 }),
    row("CCC", { sector: "utilities", trailingPE: null, dividendYield: 0.05 }),
    row("DDD", { sector: "technology", trailingPE: 15, dividendYield: 0.03, vs50d: -0.01 }),
  ];

  it("keeps every row with no filters", () => {
    expect(symbols(filterRows(rows, EMPTY_FILTERS, NO_LISTS))).toEqual(["AAA", "BBB", "CCC", "DDD"]);
  });

  it("filters by sector set", () => {
    expect(symbols(filterRows(rows, filters({ sectors: ["technology", "utilities"] }), NO_LISTS))).toEqual(["AAA", "CCC", "DDD"]);
    expect(filterRows([row("ETF", { sector: null })], filters({ sectors: ["technology"] }), NO_LISTS)).toEqual([]);
  });

  it("applies inclusive ranges and fails rows without a value", () => {
    const result = filterRows(rows, filters({ ranges: { pe: { min: null, max: 15 }, yield: { min: 0.03, max: null } } }), NO_LISTS);
    expect(symbols(result)).toEqual(["AAA", "DDD"]);
    expect(symbols(filterRows(rows, filters({ ranges: { pe: { min: 15, max: 15 } } }), NO_LISTS))).toEqual(["DDD"]);
  });

  it("filters on factor values and percentiles", () => {
    const factorRows = [row("LOW", { percentiles: { momentum: 10, reversal: 10, high52: 10, volatility: 12, beta: 10 } }), row("HIGH")];
    expect(symbols(filterRows(factorRows, filters({ ranges: { volPct: { min: null, max: 20 } } }), NO_LISTS))).toEqual(["LOW"]);
    expect(symbols(filterRows(factorRows, filters({ ranges: { beta: { min: 1, max: 1.2 } } }), NO_LISTS))).toEqual(["LOW", "HIGH"]);
  });

  it("filters above or below the moving averages", () => {
    expect(symbols(filterRows(rows, filters({ ma200: "above" }), NO_LISTS))).toEqual(["AAA", "CCC", "DDD"]);
    expect(symbols(filterRows(rows, filters({ ma200: "below" }), NO_LISTS))).toEqual(["BBB"]);
    expect(symbols(filterRows(rows, filters({ ma50: "below" }), NO_LISTS))).toEqual(["DDD"]);
    expect(filterRows([row("NA", { vs50d: null })], filters({ ma50: "above" }), NO_LISTS)).toEqual([]);
  });

  it("filters by watchlist and holdings membership", () => {
    const context: FilterContext = { watchlist: new Set(["AAA", "BBB"]), holdings: new Set(["BBB", "CCC"]), now: NOW };
    expect(symbols(filterRows(rows, filters({ list: "watchlist" }), context))).toEqual(["AAA", "BBB"]);
    expect(symbols(filterRows(rows, filters({ list: "holdings" }), context))).toEqual(["BBB", "CCC"]);
    expect(symbols(filterRows(rows, filters({ list: "either" }), context))).toEqual(["AAA", "BBB", "CCC"]);
    expect(symbols(filterRows(rows, filters({ list: "neither" }), context))).toEqual(["DDD"]);
  });

  it("filters earnings within N New York calendar days of the snapshot", () => {
    const earnings = [
      row("TODAY", { nextEarningsDate: "2026-11-07T21:00:00Z" }),
      // 01:00 UTC on Nov 15 is still Nov 14 in New York: 7 days out.
      row("WEEK", { nextEarningsDate: "2026-11-15T01:00:00Z" }),
      row("LATER", { nextEarningsDate: "2026-11-16T13:00:00Z" }),
      row("PAST", { nextEarningsDate: "2026-11-06T13:00:00Z" }),
      row("NONE", { nextEarningsDate: null }),
    ];
    expect(symbols(filterRows(earnings, filters({ earningsWithinDays: 7 }), NO_LISTS))).toEqual(["TODAY", "WEEK"]);
    expect(symbols(filterRows(earnings, filters({ earningsWithinDays: 0 }), NO_LISTS))).toEqual(["TODAY"]);
  });

  it("counts calendar days in New York", () => {
    expect(daysUntil("2026-11-08T04:30:00Z", NOW)).toBe(0); // 23:30 on Nov 7 in New York
    expect(daysUntil("2026-11-08T05:30:00Z", NOW)).toBe(1);
    expect(daysUntil("2026-11-06T12:00:00Z", NOW)).toBe(-1);
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("not a date", NOW)).toBeNull();
    expect(newYorkDate(Date.parse("2026-11-12T05:00:00.000Z"))).toBe("2026-11-12");
  });

  it("counts rows per sector", () => {
    expect(sectorCounts(rows)).toEqual({ technology: 2, energy: 1, utilities: 1 });
  });
});

describe("filter state helpers", () => {
  const active = filters({
    sectors: ["energy"],
    ranges: { pe: { min: null, max: 15 }, yield: { min: 0.03, max: null } },
    ma200: "above",
    earningsWithinDays: 14,
    list: "neither",
  });

  it("counts criteria and lists them as chips in a stable order", () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
    expect(countActiveFilters(active)).toBe(6);
    expect(activeFilterChips(active).map((chip) => chip.id)).toEqual(["sectors", "range:pe", "range:yield", "ma200", "earnings", "list"]);
  });

  it("removes one criterion at a time", () => {
    expect(removeFilter(active, "range:pe").ranges).toEqual({ yield: { min: 0.03, max: null } });
    expect(removeFilter(active, "sectors").sectors).toEqual([]);
    expect(removeFilter(active, "ma200").ma200).toBeNull();
    expect(removeFilter(active, "earnings").earningsWithinDays).toBeNull();
    expect(removeFilter(active, "list").list).toBeNull();
  });

  it("sets and clears a range", () => {
    expect(setRange(EMPTY_FILTERS, "pe", { min: 5, max: null }).ranges).toEqual({ pe: { min: 5, max: null } });
    expect(setRange(active, "pe", { min: null, max: null }).ranges).toEqual({ yield: { min: 0.03, max: null } });
  });

  it("normalizes filters for a universe", () => {
    const messy = filters({
      sectors: ["utilities", "technology", "technology"],
      ranges: { pe: { min: null, max: null }, er: { min: 0, max: 0.001 }, cap: { min: 1e10, max: Number.NaN } },
      earningsWithinDays: 7.5,
    });
    expect(normalizeFilters(messy, "stocks")).toEqual(filters({ sectors: ["technology", "utilities"], ranges: { cap: { min: 1e10, max: null } } }));
    const etf = normalizeFilters(filters({ sectors: ["energy"], earningsWithinDays: 7, ranges: { er: { min: null, max: 0.001 } } }), "etfs");
    expect(etf).toEqual(filters({ ranges: { er: { min: null, max: 0.001 } } }));
  });

  it("compares filters by content", () => {
    expect(filtersEqual(filters({ sectors: ["energy", "utilities"] }), filters({ sectors: ["utilities", "energy"] }))).toBe(true);
    expect(filtersEqual(filters({ ranges: { pe: { min: null, max: 15 } } }), filters({ ranges: { pe: { min: null, max: 16 } } }))).toBe(false);
    expect(filtersEqual(filters({ ranges: {} }), filters({ ranges: { pe: { min: null, max: null } } }))).toBe(true);
    expect(filtersEqual(filters({ list: "watchlist" }), EMPTY_FILTERS)).toBe(false);
  });
});

describe("sorting", () => {
  const rows = [row("A", { trailingPE: 30 }), row("B", { trailingPE: null }), row("C", { trailingPE: 10 }), row("D", { trailingPE: 30 })];

  it("sorts by a metric with missing values last and ties in snapshot order", () => {
    expect(symbols(sortScreenRows(rows, { key: "pe", direction: "desc" }))).toEqual(["A", "D", "C", "B"]);
    expect(symbols(sortScreenRows(rows, { key: "pe", direction: "asc" }))).toEqual(["C", "A", "D", "B"]);
  });

  it("keeps the snapshot order without a sort or for an unknown key", () => {
    expect(symbols(sortScreenRows(rows, null))).toEqual(["A", "B", "C", "D"]);
    expect(symbols(sortScreenRows(rows, { key: "bogus", direction: "asc" }))).toEqual(["A", "B", "C", "D"]);
  });

  it("starts numbers high first and text and dates in ascending order", () => {
    expect(firstSortDirection("pe")).toBe("desc");
    expect(firstSortDirection("symbol")).toBe("asc");
    expect(firstSortDirection("earnings")).toBe("asc");
  });
});

describe("column sets", () => {
  it("lead with the symbol and the name and only use fields the universe has", () => {
    for (const universe of ["stocks", "etfs"] as const) {
      for (const [set, keys] of Object.entries(COLUMN_SETS[universe])) {
        expect(keys.slice(0, 2), `${universe}/${set}`).toEqual(["symbol", "name"]);
        for (const key of keys) expect(METRICS[key].universes, `${universe}/${set}/${key}`).toContain(universe);
        for (const key of PHONE_COLUMNS[universe][set as keyof (typeof COLUMN_SETS)["stocks"]]) expect(keys, `${universe}/${set} phone`).toContain(key);
      }
    }
  });

  it("gives ETFs their fund columns", () => {
    expect(columnsFor({ universe: "etfs", columns: "overview" })).toEqual(["symbol", "name", "price", "assets", "er", "ytd", "r1m", "r3m", "r6m", "vol", "beta"]);
    expect(columnsFor({ universe: "stocks", columns: "factors" })).toEqual(["symbol", "name", "momPct", "revPct", "highPct", "volPct", "betaPct"]);
  });
});

describe("presets", () => {
  it("define the agreed criteria", () => {
    const byKey = Object.fromEntries(PRESETS.map((p) => [p.key, p.filters]));
    expect(byKey.nearHigh.ranges).toEqual({ high: { min: -0.03, max: null } });
    expect(byKey.dividendValue.ranges).toEqual({ pe: { min: null, max: 15 }, yield: { min: 0.03, max: null } });
    expect(byKey.earningsWeek.earningsWithinDays).toBe(7);
    expect(byKey.lowVol.ranges).toEqual({ volPct: { min: null, max: 20 } });
    expect(byKey.above200.ma200).toBe("above");
    expect(byKey.pullback.ranges).toEqual({ high: { min: -0.2, max: -0.1 } });
    expect(byKey.analystBuy.ranges).toEqual({ rating: { min: null, max: 2 } });
  });

  it("only offers presets the universe can evaluate", () => {
    expect(presetsFor("stocks")).toHaveLength(7);
    expect(presetsFor("etfs").map((p) => p.key)).toEqual(["nearHigh", "lowVol", "above200", "pullback"]);
  });

  it("applies a preset's filters, columns and sort and recognizes it afterwards", () => {
    const screen = applyPreset({ ...defaultScreen("stocks"), filters: filters({ list: "watchlist" }) }, "dividendValue");
    expect(screen.filters.list).toBeNull();
    expect(screen.columns).toBe("dividends");
    expect(screen.sort).toEqual({ key: "yield", direction: "desc" });
    expect(activePreset(screen)).toBe("dividendValue");
    expect(activePreset(defaultScreen("stocks"))).toBeNull();
    expect(applyPreset(defaultScreen("etfs"), "analystBuy")).toEqual(defaultScreen("etfs"));
  });

  it("finds the matching rows", () => {
    const rows = [
      row("HIGH", { fromHigh52: -0.01 }),
      row("DIP", { fromHigh52: -0.15 }),
      row("DEEP", { fromHigh52: -0.3 }),
      row("BUY", { analystRating: 1.8, fromHigh52: -0.5 }),
    ];
    const run = (key: (typeof PRESETS)[number]["key"]) => symbols(filterRows(rows, applyPreset(defaultScreen(), key).filters, NO_LISTS));
    expect(run("nearHigh")).toEqual(["HIGH"]);
    expect(run("pullback")).toEqual(["DIP"]);
    expect(run("analystBuy")).toEqual(["BUY"]);
  });
});

describe("screens and links", () => {
  const screen: Screen = {
    universe: "stocks",
    filters: filters({
      sectors: ["energy", "technology"],
      ranges: { yield: { min: 0.03, max: null }, pe: { min: null, max: 15 }, high: { min: -0.2, max: -0.1 }, cap: { min: 1e10, max: 2e11 } },
      ma50: "above",
      ma200: "below",
      earningsWithinDays: 14,
      list: "neither",
    }),
    columns: "valuation",
    sort: { key: "pe", direction: "asc" },
  };

  it("writes nothing for the default screen", () => {
    expect(screenToQuery(defaultScreen("stocks"))).toBe("");
    expect(screenToQuery(defaultScreen("etfs"))).toBe("u=etfs");
  });

  it("writes ranges in typed units", () => {
    const params = new URLSearchParams(screenToQuery(screen));
    expect(params.get("yield")).toBe("3..");
    expect(params.get("pe")).toBe("..15");
    expect(params.get("high")).toBe("-20..-10");
    expect(params.get("cap")).toBe("10..200");
    expect(params.get("sector")).toBe("technology,energy");
    expect(params.get("sort")).toBe("pe.asc");
    expect(params.get("cols")).toBe("valuation");
  });

  it("round-trips a screen through its link", () => {
    expect(screenFromParams(new URLSearchParams(screenToQuery(screen)))).toEqual(normalizeScreen(screen));
    const etfs: Screen = { universe: "etfs", filters: filters({ ranges: { er: { min: null, max: 0.001 }, volPct: { min: null, max: 20 } } }), columns: "risk", sort: null };
    expect(screenFromParams(new URLSearchParams(screenToQuery(etfs)))).toEqual(etfs);
  });

  it("ignores malformed and unknown parameters", () => {
    const parsed = screenFromParams(
      new URLSearchParams("u=crypto&sector=energy,mars&pe=abc&yield=..&rsi=30..x&earn=7d&list=friends&ma50=up&cols=all&sort=drop.table&tab=discover"),
    );
    expect(parsed).toEqual({ ...defaultScreen("stocks"), filters: filters({ sectors: ["energy"] }) });
    expect(screenFromParams(new URLSearchParams("sort=none")).sort).toBeNull();
    expect(screenFromParams(new URLSearchParams("u=etfs&sort=cap.desc")).sort).toEqual({ key: "assets", direction: "desc" });
    expect(screenFromParams(new URLSearchParams("u=etfs&sector=energy&earn=7")).filters).toEqual(EMPTY_FILTERS);
  });

  it("reads Next.js search params", () => {
    expect(searchParamsFrom({ a: "1", b: ["2", "3"], c: undefined }).toString()).toBe("a=1&b=2");
  });

  it("switches universe and drops what the other one cannot use", () => {
    const etfs = switchUniverse(screen, "etfs");
    expect(etfs.universe).toBe("etfs");
    expect(etfs.filters.sectors).toEqual([]);
    expect(etfs.filters.earningsWithinDays).toBeNull();
    expect(etfs.filters.ranges).toEqual({ yield: { min: 0.03, max: null }, pe: { min: null, max: 15 }, high: { min: -0.2, max: -0.1 } });
    expect(etfs.sort).toEqual({ key: "pe", direction: "asc" });
    expect(switchUniverse({ ...screen, sort: { key: "rating", direction: "asc" } }, "etfs").sort).toEqual({ key: "assets", direction: "desc" });
    expect(switchUniverse(screen, "stocks")).toBe(screen);
  });
});

describe("CSV export", () => {
  it("escapes fields as RFC 4180 requires", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(12.5)).toBe("12.5");
    expect(csvField("plain")).toBe("plain");
    expect(csvField("Acme, Inc.")).toBe('"Acme, Inc."');
    expect(csvField('The "Best" Co')).toBe('"The ""Best"" Co"');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
  });

  it("exports every field in typed units with CRLF line ends", () => {
    const csv = toCsv(
      [
        row("AAPL", { name: "Apple, Inc.", dividendYield: 0.0045, marketCap: 3.9e12, nextEarningsDate: "2027-01-29T21:30:00Z", exDividendDate: "2026-11-10T05:00:00.000Z" }),
        row("BRK-B", { name: '=HYPERLINK("x")', sector: "financials", trailingPE: null }),
      ],
      "stocks",
      (key) => (key === "technology" ? "Information Technology" : "Financials"),
    );
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe("");
    const header = lines[0].split(",");
    expect(header.slice(0, 4)).toEqual(["Symbol", "Name", "Sector", "Price"]);
    const first = lines[1];
    expect(first.startsWith('AAPL,"Apple, Inc.",Information Technology,100,1,3900000000000,20,')).toBe(true);
    expect(first).toContain(",0.45,");
    expect(first).toContain(",2026-11-10,");
    expect(first).toContain(",2027-01-29,");
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[2]).toContain("Financials,100,1,100000000000,,18,");
  });

  it("uses the fund columns for ETFs", () => {
    const header = toCsv([], "etfs").split("\r\n")[0];
    expect(header).toContain("Expense ratio %");
    expect(header).toContain("Net assets (USD)");
    expect(header).not.toContain("Sector");
  });

  it("names the file by universe and New York date", () => {
    expect(csvFileName("etfs", "2026-11-08T03:00:00Z")).toBe("investseek-screener-etfs-2026-11-07.csv");
  });
});

describe("saved screens", () => {
  const screen = applyPreset(defaultScreen("stocks"), "lowVol");
  const entry = (id: string, name: string, query = "") => ({ id, name, query, savedAt: "2026-11-07T15:00:00.000Z" });

  it("adds new screens first, updates by name and refuses empty names", () => {
    let { list, result } = upsertSavedScreen([], { id: "a", name: "  Low   vol ", screen, savedAt: "2026-11-07T15:00:00.000Z" });
    expect(result).toBe("saved");
    expect(list).toEqual([{ id: "a", name: "Low vol", query: screenToQuery(screen), savedAt: "2026-11-07T15:00:00.000Z" }]);
    ({ list, result } = upsertSavedScreen(list, { id: "b", name: "Dividends", screen: applyPreset(screen, "dividendValue"), savedAt: "2026-11-07T16:00:00.000Z" }));
    expect(list.map((s) => s.name)).toEqual(["Dividends", "Low vol"]);
    ({ list, result } = upsertSavedScreen(list, { id: "c", name: "LOW VOL", screen: defaultScreen("etfs"), savedAt: "2026-11-07T17:00:00.000Z" }));
    expect(result).toBe("updated");
    expect(list.map((s) => [s.id, s.name, s.query])).toEqual([
      ["a", "LOW VOL", "u=etfs"],
      ["b", "Dividends", list[1].query],
    ]);
    expect(upsertSavedScreen(list, { id: "d", name: "   ", screen, savedAt: "x" }).result).toBe("invalid");
  });

  it("holds at most 30 screens", () => {
    const full = Array.from({ length: MAX_SAVED_SCREENS }, (_, i) => entry(`id${i}`, `Screen ${i}`));
    expect(upsertSavedScreen(full, { id: "new", name: "One more", screen, savedAt: "x" }).result).toBe("full");
    expect(upsertSavedScreen(full, { id: "new", name: "Screen 3", screen, savedAt: "x" }).result).toBe("updated");
  });

  it("removes and restores a screen at its position", () => {
    const list = [entry("a", "A"), entry("b", "B"), entry("c", "C")];
    const removed = removeSavedScreen(list, "b");
    expect(removed.map((s) => s.id)).toEqual(["a", "c"]);
    expect(restoreSavedScreen(removed, list[1], 1).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(restoreSavedScreen(list, list[1], 1)).toBe(list);
  });

  it("sanitizes stored data", () => {
    const raw = [
      entry("a", "Keep", "yield=3..&bogus=1"),
      entry("a", "Duplicate id"),
      entry("b", "keep"),
      { id: "bad id!", name: "Bad", query: "" },
      { id: "c", name: "", query: "" },
      { id: "d", name: "No query" },
      { id: "e", name: "Old date", query: "u=etfs", savedAt: "yesterday" },
      null,
      "junk",
    ];
    const clean = sanitizeSavedScreens(raw);
    expect(clean.map((s) => s.id)).toEqual(["a", "e"]);
    expect(clean[0].query).toBe("yield=3..");
    expect(clean[1].savedAt).toBe(new Date(0).toISOString());
    expect(sanitizeSavedScreens({ not: "a list" })).toEqual([]);
    expect(sanitizeSavedScreens(Array.from({ length: 40 }, (_, i) => entry(`id${i}`, `S${i}`)))).toHaveLength(MAX_SAVED_SCREENS);
  });

  describe("store", () => {
    const storage = new Map<string, string>();
    beforeEach(() => {
      storage.clear();
      vi.stubGlobal("window", {
        localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
        addEventListener: () => {},
        removeEventListener: () => {},
      });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("persists under investseek:screens:v1", () => {
      expect(screensStore.key).toBe("investseek:screens:v1");
      const saved: SavedScreen[] = [entry("a", "Mine", "u=etfs")];
      screensStore.write(saved);
      expect(JSON.parse(storage.get("investseek:screens:v1") ?? "[]")).toEqual(saved);
      storage.set("investseek:screens:v1", JSON.stringify([...saved, { id: 1 }]));
      screensStore.update((current) => current);
      expect(screensStore.getSnapshot()).toEqual(saved);
    });
  });
});

describe("discover helpers", () => {
  it("maps cap floors to and from link values", () => {
    expect(capParam(3e8)).toBe("300M");
    expect(capParam(1e11)).toBe("100B");
    expect(parseCapParam("10b")).toBe(1e10);
    expect(parseCapParam("300M")).toBe(3e8);
    expect(parseCapParam("5B")).toBe(DEFAULT_DISCOVER_CAP);
    expect(parseCapParam(null)).toBe(1e9);
  });

  it("computes relative volume", () => {
    expect(relativeVolume(3e6, 1.5e6)).toBe(2);
    expect(relativeVolume(null, 1e6)).toBeNull();
    expect(relativeVolume(1e6, 0)).toBeNull();
  });

  it("names analyst ratings on Yahoo's bands", () => {
    expect(ratingKey(1.2)).toBe("strong_buy");
    expect(ratingKey(1.5)).toBe("buy");
    expect(ratingKey(2.49)).toBe("buy");
    expect(ratingKey(2.5)).toBe("hold");
    expect(ratingKey(3.6)).toBe("underperform");
    expect(ratingKey(4.6)).toBe("sell");
    expect(ratingKey(null)).toBeNull();
    expect(ratingKey(0)).toBeNull();
  });
});
