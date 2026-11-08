import { describe, expect, it } from "vitest";

import { formatQuotePrice, priceDigits, reportedChange, reportedPrice, reportedVolume } from "./quote-figures";

describe("Yahoo placeholder prices", () => {
  it("reads a zero open, day range, 52-week end, previous close, bid or ask as not reported", () => {
    expect(reportedPrice(0)).toBeNull();
    expect(reportedPrice(null)).toBeNull();
    expect(reportedPrice(4.859)).toBe(4.859);
    // A negative futures price is a price (WTI, April 2020).
    expect(reportedPrice(-37.63)).toBe(-37.63);
  });
});

describe("Yahoo placeholder changes", () => {
  it("recomputes a change Yahoo derived from a price of 0 (Treasury yields on 2026-11-08)", () => {
    const tnx = reportedChange(-4.837, -49.886547, 4.859, 4.837);
    expect(tnx.change).toBeCloseTo(0.022, 10);
    expect(tnx.changePercent).toBeCloseTo((0.022 / 4.837) * 100, 10);
    const fvx = reportedChange(-4.6080003, -49.783924, 4.648, 4.6080003);
    expect(fvx.change).toBeCloseTo(0.0399997, 6);
  });

  it("keeps every other change as Yahoo sent it", () => {
    expect(reportedChange(0.022000313, 0.45483, 4.859, 4.837)).toEqual({ change: 0.022000313, changePercent: 0.45483 });
    // BTC-USD measures its change against a 24-hour reference, not the previous close.
    expect(reportedChange(-272.07812, -0.358, 75669.22, 75753.71)).toEqual({ change: -272.07812, changePercent: -0.358 });
    expect(reportedChange(null, null, 4.859, 4.837)).toEqual({ change: null, changePercent: null });
    expect(reportedChange(-4.837, -49.9, null, 4.837)).toEqual({ change: -4.837, changePercent: -49.9 });
    expect(reportedChange(-4.837, -49.9, 4.859, null)).toEqual({ change: -4.837, changePercent: -49.9 });
  });
});

describe("Yahoo placeholder volumes", () => {
  it("keeps a zero volume for stocks and ETFs, where it can be real", () => {
    // A stock before its first trade of the day, or a halted one, has traded nothing.
    expect(reportedVolume(0, "EQUITY")).toBe(0);
    expect(reportedVolume(0, "ETF")).toBe(0);
    expect(reportedVolume(43_750_861, "EQUITY")).toBe(43_750_861);
  });

  it("drops a zero volume for the quote types that report none (2026-11-07 quotes)", () => {
    expect(reportedVolume(0, "INDEX")).toBeNull(); // ^TNX, ^VIX, ^N225
    expect(reportedVolume(0, "CURRENCY")).toBeNull(); // EURUSD=X
    expect(reportedVolume(0, "MUTUALFUND")).toBeNull(); // VFIAX's average volume
    expect(reportedVolume(0, "FUTURE")).toBeNull();
    expect(reportedVolume(0, "CRYPTOCURRENCY")).toBeNull();
  });

  it("keeps real volumes of every type, missing ones and zeros of an unknown type", () => {
    expect(reportedVolume(3_410_452_000, "INDEX")).toBe(3_410_452_000); // ^GSPC
    expect(reportedVolume(166_431, "FUTURE")).toBe(166_431); // GC=F
    expect(reportedVolume(null, "ETF")).toBeNull();
    expect(reportedVolume(0, null)).toBe(0);
  });
});

describe("price decimals", () => {
  it("gives the world board's instruments its digits, yields three, other pairs four and the rest none", () => {
    expect(priceDigits("EURUSD=X", "CURRENCY")).toBe(4);
    expect(priceDigits("USDJPY=X", "CURRENCY")).toBe(3);
    expect(priceDigits("HG=F", "FUTURE")).toBe(4);
    expect(priceDigits("^GSPC", "INDEX")).toBe(2);
    // The four Treasury yields read alike, whether or not the markets board lists them (it lists ^TNX), and before
    // their quote arrives.
    for (const symbol of ["^IRX", "^FVX", "^TNX", "^TYX"]) {
      expect(priceDigits(symbol, "INDEX"), symbol).toBe(3);
      expect(priceDigits(symbol, null), symbol).toBe(3);
    }
    // A pair the world board does not list, by quote type or by Yahoo's "=X" before the quote arrives.
    expect(priceDigits("AUDUSD=X", "CURRENCY")).toBe(4);
    expect(priceDigits("AUDUSD=X", null)).toBe(4);
    expect(priceDigits("AAPL", "EQUITY")).toBeNull();
    expect(priceDigits("ES=F", "FUTURE")).toBeNull();
    expect(priceDigits("^VIX", "INDEX")).toBeNull();
  });

  it("formats with those decimals, or with formatPrice's rule", () => {
    expect(formatQuotePrice(1.1143303, 4, "en")).toBe("1.1143");
    expect(formatQuotePrice(158.425, 3, "en")).toBe("158.425");
    expect(formatQuotePrice(4.859, 3, "zh")).toBe("4.859");
    expect(formatQuotePrice(1.1143303, null, "en")).toBe("1.11");
    expect(formatQuotePrice(0.12345, null, "en")).toBe("0.1235");
    expect(formatQuotePrice(null, 4, "en")).toBe("—");
  });
});
