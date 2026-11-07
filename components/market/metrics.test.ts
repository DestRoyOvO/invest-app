import { describe, expect, it } from "vitest";

import { rangePosition, relativeVolume, sharePercent } from "./metrics";

describe("relativeVolume", () => {
  it("divides today's volume by the 3-month average", () => {
    expect(relativeVolume({ volume: 300, avgVolume: 100 })).toBe(3);
    expect(relativeVolume({ volume: 0, avgVolume: 100 })).toBe(0);
  });

  it("is null without both numbers or with a zero average", () => {
    expect(relativeVolume({ volume: null, avgVolume: 100 })).toBeNull();
    expect(relativeVolume({ volume: 100, avgVolume: null })).toBeNull();
    expect(relativeVolume({ volume: 100, avgVolume: 0 })).toBeNull();
  });
});

describe("rangePosition", () => {
  it("places the price between the 52-week low and high", () => {
    expect(rangePosition({ price: 150, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 200 })).toBe(50);
    expect(rangePosition({ price: 250, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 200 })).toBe(100);
    expect(rangePosition({ price: 90, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 200 })).toBe(0);
  });

  it("is null without a valid range or price", () => {
    expect(rangePosition({ price: 150, fiftyTwoWeekLow: null, fiftyTwoWeekHigh: 200 })).toBeNull();
    expect(rangePosition({ price: 150, fiftyTwoWeekLow: 200, fiftyTwoWeekHigh: 200 })).toBeNull();
    expect(rangePosition({ price: null, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 200 })).toBeNull();
  });
});

describe("sharePercent", () => {
  it("rounds to whole percent", () => {
    expect(sharePercent(44, 78)).toBe(56);
    expect(sharePercent(0, 78)).toBe(0);
    expect(sharePercent(1, 0)).toBeNull();
  });
});
