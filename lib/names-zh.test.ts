import { describe, expect, it } from "vitest";

import { CHINESE_NAMES, chineseNameOf, displayName, fullName, hasCjk, searchChineseNames, symbolTitle } from "./names-zh";
import { ETF_UNIVERSE } from "./screens";
import { normalizeSymbol } from "./symbols";
import { BREADTH_REFERENCES, MARKET_BOARD, UNIVERSE_STOCKS, WORLD_BOARD } from "./universe";

/** Every symbol the app lists by itself: the stock and ETF universes, the market and world boards, the breadth funds. */
const APP_UNIVERSE = [
  ...new Set([...UNIVERSE_STOCKS, ...ETF_UNIVERSE, ...MARKET_BOARD.map((item) => item.symbol), ...WORLD_BOARD.map((item) => item.symbol), ...Object.values(BREADTH_REFERENCES)]),
];

/**
 * Universe symbols without an established Chinese name, so Chinese pages show Yahoo's English name for them. Add a
 * symbol here rather than guess a name: a wrong Chinese name is worse than the English one.
 */
const WITHOUT_CHINESE_NAME: readonly string[] = [];

/** Universe symbols that Chinese financial media call by a Latin name; Chinese pages show that name. */
const LATIN_NAMES: readonly string[] = ["META", "TMUS", "BKNG"];

/** Names compare the way search matches them: case and spaces ignored. */
const nameKey = (name: string) => name.toLowerCase().replace(/\s+/g, "");

describe("Chinese names", () => {
  it("lists valid, unique symbols", () => {
    const symbols = CHINESE_NAMES.map((entry) => entry.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    for (const symbol of symbols) expect(normalizeSymbol(symbol)).toBe(symbol);
  });

  it("names every symbol of the app's universe apart from an explicit list", () => {
    expect(APP_UNIVERSE.length).toBeGreaterThan(130);
    expect(APP_UNIVERSE.filter((symbol) => !chineseNameOf(symbol))).toEqual(WITHOUT_CHINESE_NAME);
    expect(APP_UNIVERSE.filter((symbol) => !hasCjk(chineseNameOf(symbol) ?? "中"))).toEqual(LATIN_NAMES);
  });

  it("never uses one name for two different symbols", () => {
    const owners = new Map<string, Set<string>>();
    for (const entry of CHINESE_NAMES) {
      for (const name of entry.names) {
        const key = nameKey(name);
        owners.set(key, (owners.get(key) ?? new Set()).add(entry.symbol));
      }
    }
    const shared = [...owners].filter(([, symbols]) => symbols.size > 1).map(([name, symbols]) => `${name}: ${[...symbols].join(", ")}`);
    expect(shared).toEqual([]);
  });

  it("keeps the names themselves tidy", () => {
    for (const entry of CHINESE_NAMES) {
      for (const name of entry.names) expect(name, entry.symbol).toBe(name.trim());
      expect(new Set(entry.names.map(nameKey)).size, entry.symbol).toBe(entry.names.length);
    }
  });

  it("ranks exact names before prefixes and substrings", () => {
    expect(searchChineseNames("苹果")[0]).toEqual({ symbol: "AAPL", name: "苹果" });
    expect(searchChineseNames("腾讯").map((r) => r.symbol)).toEqual(["0700.HK", "TME"]);
    expect(searchChineseNames("摩根").map((r) => r.symbol)).toEqual(["JPM", "MS"]);
    expect(searchChineseNames("标普 500")[0]).toEqual({ symbol: "^GSPC", name: "标普500指数" });
    // 纳指 alone is the Composite in Chinese market reports; 纳指100 is the Nasdaq-100.
    expect(searchChineseNames("纳指").map((r) => r.symbol)).toEqual(["^IXIC", "^NDX", "QQQ"]);
    expect(searchChineseNames("伯克希尔哈撒韦")[0]).toEqual({ symbol: "BRK-B", name: "伯克希尔·哈撒韦" });
  });

  it("matches Latin aliases case-insensitively and caps the result count", () => {
    expect(searchChineseNames("visa")[0].symbol).toBe("V");
    expect(searchChineseNames("ETF", 3)).toHaveLength(3);
    expect(searchChineseNames("  ")).toEqual([]);
  });

  it("detects CJK text", () => {
    expect(hasCjk("英伟达")).toBe(true);
    expect(hasCjk("nvda")).toBe(false);
  });
});

describe("displayName", () => {
  it("shows the Chinese name in Chinese when one is known", () => {
    expect(displayName("AAPL", "Apple Inc.", "zh")).toBe("苹果");
    expect(displayName("SPY", "State Street SPDR S&P 500 ETF Trust", "zh")).toBe("标普500 ETF");
    expect(displayName("^GSPC", null, "zh")).toBe("标普500指数");
  });

  it("falls back to the English name, trimmed", () => {
    expect(displayName("KRMN", " Karman Holdings Inc. ", "zh")).toBe("Karman Holdings Inc.");
    expect(displayName("AAPL", "Apple Inc.", "en")).toBe("Apple Inc.");
    expect(displayName(null, "Apple Inc.", "zh")).toBe("Apple Inc.");
  });

  it("returns null when there is no name to show", () => {
    expect(displayName("KRMN", null, "zh")).toBeNull();
    expect(displayName("AAPL", "  ", "en")).toBeNull();
    expect(displayName(undefined, undefined, "en")).toBeNull();
  });
});

describe("fullName", () => {
  it("gives both names where they differ", () => {
    expect(fullName("AAPL", "Apple Inc.", "zh")).toBe("苹果 · Apple Inc.");
    expect(fullName("^GSPC", null, "zh")).toBe("标普500指数");
  });

  it("gives the one name otherwise", () => {
    expect(fullName("AAPL", "Apple Inc.", "en")).toBe("Apple Inc.");
    expect(fullName("KRMN", "Karman Holdings Inc.", "zh")).toBe("Karman Holdings Inc.");
    expect(fullName("KRMN", null, "en")).toBeNull();
  });
});

describe("symbolTitle", () => {
  it("puts the Chinese name in front of the symbol in Chinese", () => {
    expect(symbolTitle("NVDA", "zh")).toBe("英伟达 NVDA");
    expect(symbolTitle("BRK-B", "zh")).toBe("伯克希尔·哈撒韦 BRK-B");
  });

  it("keeps the symbol alone in English and for symbols without a Chinese name", () => {
    expect(symbolTitle("NVDA", "en")).toBe("NVDA");
    expect(symbolTitle("KRMN", "zh")).toBe("KRMN");
  });
});
