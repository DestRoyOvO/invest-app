import { describe, expect, it } from "vitest";

import { screenerPageTitle, screenerTitle } from "./titles";

describe("screener page titles", () => {
  it("names each tab in the reader's language", () => {
    expect(screenerTitle("screener", "en")).toBe("Screener");
    expect(screenerTitle("discover", "en")).toBe("Discover");
    expect(screenerTitle("screener", "zh")).toBe("选股器");
    expect(screenerTitle("discover", "zh")).toBe("全市场");
  });

  it("swaps the page part and keeps the site suffix", () => {
    expect(screenerPageTitle("discover", "en", "Screener · InvestSeek")).toBe("Discover · InvestSeek");
    expect(screenerPageTitle("screener", "en", "Discover · InvestSeek")).toBe("Screener · InvestSeek");
    expect(screenerPageTitle("discover", "en", "AAPL · Apple Inc. · InvestSeek")).toBe("Discover · InvestSeek");
    expect(screenerPageTitle("screener", "en", "")).toBe("Screener");
  });

  it("follows a language switch on the open page", () => {
    expect(screenerPageTitle("screener", "zh", "Screener · InvestSeek")).toBe("选股器 · InvestSeek");
    expect(screenerPageTitle("discover", "en", "全市场 · InvestSeek")).toBe("Discover · InvestSeek");
  });
});
