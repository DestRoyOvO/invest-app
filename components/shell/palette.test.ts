import { describe, expect, it } from "vitest";

import type { SymbolSearchResult } from "@/types/api";

import { buildPalette, shouldSearch, type PaletteInput, type PaletteItem } from "./palette";

const base: PaletteInput = { query: "", lastSymbol: "AAPL", lastSector: null, recents: [], watchlist: [], results: null };
const result = (symbol: string, name = `${symbol} Inc`): SymbolSearchResult => ({ symbol, name, exchange: "NMS", type: "EQUITY" });

function build(overrides: Partial<PaletteInput>): PaletteItem[] {
  return buildPalette({ ...base, ...overrides });
}

function summary(items: PaletteItem[]): string[] {
  return items.map((item) => {
    switch (item.kind) {
      case "function":
        return `fn:${item.match.fn.code}${item.match.symbol ? `:${item.match.symbol}` : ""}`;
      case "action":
        return `${item.action}:${item.symbol}`;
      case "symbol":
        return `${item.section}:${item.symbol}`;
      case "sector":
        return `sector:${item.key}`;
      case "setting":
        return item.choice.kind === "lang" ? "set:lang" : `set:${item.choice.kind}:${item.choice.value}`;
      case "ask":
        return `ask:${item.question}`;
    }
  });
}

describe("buildPalette", () => {
  it("lists recent symbols, the rest of the watchlist and every function for an empty query", () => {
    const items = build({ recents: ["NVDA", "KO"], watchlist: ["KO", "MSFT", "SPY"] });
    const lines = summary(items);
    expect(lines.slice(0, 4)).toEqual(["recents:NVDA", "recents:KO", "watchlist:MSFT", "watchlist:SPY"]);
    const functions = items.filter((item) => item.kind === "function");
    expect(functions).toHaveLength(16);
    expect(lines).toContain("fn:QT:AAPL");
    expect(lines).not.toContain("fn:GP:AAPL");
  });

  it("caps recents at 8 and the watchlist at 10", () => {
    const many = Array.from({ length: 30 }, (_, i) => `S${i}`);
    const items = build({ recents: many.slice(0, 12), watchlist: many });
    expect(items.filter((item) => item.section === "recents")).toHaveLength(8);
    expect(items.filter((item) => item.section === "watchlist")).toHaveLength(10);
  });

  it("puts the actions of an exact symbol first, then other search results", () => {
    const items = build({ query: "nvda", results: [result("NVDA", "NVIDIA Corporation"), result("NVDL", "GraniteShares 2x Long NVDA")] });
    expect(summary(items)).toEqual(["open:NVDA", "watch:NVDA", "position:NVDA", "alert:NVDA", "why:NVDA", "symbols:NVDL"]);
    expect(items[0]).toMatchObject({ kind: "action", name: "NVIDIA Corporation" });
  });

  it("offers removal for a symbol already on the watchlist", () => {
    expect(summary(build({ query: "NVDA", watchlist: ["NVDA"], results: [] }))[1]).toBe("unwatch:NVDA");
  });

  it("knows the universe while the search is still running", () => {
    expect(summary(build({ query: "KO", results: null }))[0]).toBe("open:KO");
  });

  it("opens an unconfirmed ticker directly while searching or when nothing was found, not next to real results", () => {
    expect(summary(build({ query: "QQQZ", results: null }))).toEqual(["symbols:QQQZ"]);
    expect(summary(build({ query: "ZZZZ", results: [] }))).toEqual(["symbols:ZZZZ"]);
    expect(summary(build({ query: "apple", results: [result("AAPL", "Apple Inc.")] }))).toEqual(["symbols:AAPL"]);
    expect(summary(build({ query: "QQQZ", results: [result("QQQZ", "Example Fund")] }))[0]).toBe("open:QQQZ");
  });

  it("ranks an exact function code first, and offers only Open for a ticker with the same name", () => {
    expect(summary(build({ query: "GP", results: null }))).toEqual(["fn:GP:AAPL"]);
    expect(summary(build({ query: "LAB", results: [result("LAB", "Standard BioTools")] }))).toEqual(["fn:LAB", "open:LAB"]);
    const gp = build({ query: "GP", results: [result("GP", "GreenPower Motor"), result("GPRO", "GoPro")] });
    expect(summary(gp)).toEqual(["fn:GP:AAPL", "open:GP", "symbols:GPRO"]);
    expect(gp[1]).toMatchObject({ kind: "action", action: "open", name: "GreenPower Motor" });
    expect(summary(build({ query: "wl", results: [] }))[0]).toBe("fn:WL");
  });

  it("reads TICKER CODE and COMP", () => {
    expect(summary(build({ query: "NVDA GP" }))).toEqual(["fn:GP:NVDA"]);
    expect(summary(build({ query: "COMP AAPL MSFT SPY" }))[0]).toBe("fn:COMP:AAPL");
  });

  it("matches Chinese company names locally", () => {
    const nvda = summary(build({ query: "英伟达" }));
    expect(nvda[0]).toBe("open:NVDA");
    const apple = build({ query: "苹果" });
    expect(apple[0]).toMatchObject({ kind: "action", action: "open", symbol: "AAPL", name: "苹果" });
    expect(summary(build({ query: "银行" })).some((line) => line.startsWith("symbols:"))).toBe(true);
  });

  it("sends questions to the assistant only", () => {
    expect(summary(build({ query: "?why is NVDA up", watchlist: ["NVDA"] }))).toEqual(["ask:why is NVDA up"]);
  });

  it("finds sectors and settings by name", () => {
    expect(summary(build({ query: "energy", results: [] }))).toContain("sector:energy");
    expect(summary(build({ query: "能源" }))).toContain("sector:energy");
    expect(summary(build({ query: "theme", results: [] })).filter((line) => line.startsWith("set:"))).toEqual(["set:theme:dark", "set:theme:light", "set:theme:system"]);
    expect(summary(build({ query: "compact", results: [] }))).toContain("set:density:compact");
    expect(summary(build({ query: "色弱" }))).toContain("set:updown:cb");
  });

  it("never repeats an item", () => {
    for (const query of ["", "N", "NO", "NOTE", "AAPL", "E", "theme", "能源"]) {
      const ids = build({ query, results: [result("AAPL"), result("NOTE")], recents: ["AAPL"], watchlist: ["AAPL", "NVDA"] }).map((item) => item.id);
      expect(new Set(ids).size, query).toBe(ids.length);
    }
  });
});

describe("shouldSearch", () => {
  it("searches Latin names and tickers, not questions, Chinese text or code grammar", () => {
    expect(shouldSearch("apple")).toBe(true);
    expect(shouldSearch("apple inc")).toBe(true);
    expect(shouldSearch("LAB")).toBe(true);
    expect(shouldSearch("")).toBe(false);
    expect(shouldSearch("?why")).toBe(false);
    expect(shouldSearch("苹果")).toBe(false);
    expect(shouldSearch("NVDA GP")).toBe(false);
    expect(shouldSearch("COMP AAPL MSFT")).toBe(false);
  });
});
