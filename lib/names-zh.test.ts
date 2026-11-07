import { describe, expect, it } from "vitest";

import { CHINESE_NAMES, chineseNameOf, hasCjk, searchChineseNames } from "./names-zh";
import { normalizeSymbol } from "./symbols";
import { UNIVERSE_STOCKS } from "./universe";

describe("Chinese names", () => {
  it("covers every universe stock with valid, unique symbols", () => {
    const symbols = CHINESE_NAMES.map((entry) => entry.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    for (const symbol of symbols) expect(normalizeSymbol(symbol)).toBe(symbol);
    for (const symbol of UNIVERSE_STOCKS) expect(chineseNameOf(symbol), symbol).toBeDefined();
  });

  it("ranks exact names before prefixes and substrings", () => {
    expect(searchChineseNames("苹果")[0]).toEqual({ symbol: "AAPL", name: "苹果" });
    expect(searchChineseNames("腾讯").map((r) => r.symbol)).toEqual(["0700.HK", "TME"]);
    expect(searchChineseNames("摩根").map((r) => r.symbol)).toEqual(["JPM", "MS"]);
    expect(searchChineseNames("标普 500")[0].symbol).toBe("^GSPC");
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
