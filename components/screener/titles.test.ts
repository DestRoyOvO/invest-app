import { describe, expect, it } from "vitest";

import { screenerPageTitle, screenerTitle } from "./titles";

describe("screener page titles", () => {
  it("names each tab in English", () => {
    expect(screenerTitle("screener")).toBe("Screener");
    expect(screenerTitle("discover")).toBe("Discover");
  });

  it("swaps the page part and keeps the site suffix", () => {
    expect(screenerPageTitle("discover", "Screener · InvestSeek")).toBe("Discover · InvestSeek");
    expect(screenerPageTitle("screener", "Discover · InvestSeek")).toBe("Screener · InvestSeek");
    expect(screenerPageTitle("discover", "AAPL · Apple Inc. · InvestSeek")).toBe("Discover · InvestSeek");
    expect(screenerPageTitle("screener", "")).toBe("Screener");
  });
});
