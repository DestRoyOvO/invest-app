import { describe, expect, it } from "vitest";

import { barWidths, dividendIncome, FINANCIAL_ROWS, fiscalYear, perShareDigits, readableName, signedFigure, yearAgoIndex, yearOverYear } from "./research-utils";

describe("signedFigure", () => {
  it("signs a figure by its value, with a true minus", () => {
    expect(signedFigure("2.0%", 0.0201)).toBe("+2.0%");
    expect(signedFigure("10.2%", -0.102)).toBe("−10.2%");
    expect(signedFigure("0.4", 0.41)).toBe("+0.4");
  });

  it("leaves a figure that shows as zero unsigned", () => {
    // AAPL's capital spending in the fixture data: 89.27B after 89.31B, a change of -0.05% that shows as 0.0%.
    expect(signedFigure("0.0%", 89.269 / 89.31 - 1)).toBe("0.0%");
    expect(signedFigure("0.0", 0.04)).toBe("0.0");
    expect(signedFigure("0.0%", 0)).toBe("0.0%");
    expect(signedFigure("0.05%", -0.0005)).toBe("−0.05%");
  });
});

describe("yearOverYear", () => {
  const years = ["2023-09-30", "2024-09-30", "2025-09-30", "2026-09-30"];
  const quarters = ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];

  it("compares the latest period with the one that ended about a year earlier", () => {
    expect(yearAgoIndex(years)).toBe(2);
    expect(yearAgoIndex(quarters)).toBe(0);
    expect(yearAgoIndex(quarters.slice(1))).toBeNull();
    // Half-yearly reporters (0700.HK): June against the June before.
    expect(yearAgoIndex(["2025-06-30", "2026-06-30"])).toBe(0);
    expect(yearAgoIndex(["2026-01-31"])).toBeNull();
    expect(yearOverYear([383, 391, 428, 478.8], years, "growth")).toBeCloseTo(478.8 / 428 - 1);
    expect(yearOverYear([94.9, 95.4, 124.3, 102.5, 114.5], quarters, "growth")).toBeCloseTo(114.5 / 94.9 - 1);
    expect(yearOverYear([2, 3, 4, 5], quarters.slice(1), "growth")).toBeNull();
  });

  it("has no growth rate from a loss, measures cash spent by its size and margins in points", () => {
    const two = years.slice(2);
    expect(yearOverYear([-5, 10], two, "growth")).toBeNull();
    expect(yearOverYear([-9.2, -9.04], two, "outflow")).toBeCloseTo(9.04 / 9.2 - 1);
    expect(yearOverYear([0.467, 0.4879], two, "points")).toBeCloseTo(2.09, 2);
    expect(yearOverYear([null, 0.5], two, "points")).toBeNull();
    expect(yearOverYear([], [], "growth")).toBeNull();
  });

  it("covers every row of the statement table", () => {
    expect(FINANCIAL_ROWS.map((row) => row.key)).toEqual([
      "revenue",
      "grossMargin",
      "operatingMargin",
      "netMargin",
      "eps",
      "ebitda",
      "operatingCashFlow",
      "capex",
      "freeCashFlow",
      "buybacks",
      "dividendsPaid",
    ]);
  });
});

describe("barWidths and labels", () => {
  it("scales bars to the largest magnitude in the row", () => {
    expect(barWidths([50, -100, null, 25])).toEqual([50, 100, null, 25]);
    expect(barWidths([0, 0])).toEqual([0, 0]);
  });

  it("names a fiscal year after the calendar year it ends in", () => {
    expect(fiscalYear("2026-09-30")).toBe(2026);
    expect(fiscalYear("2026-01-25")).toBe(2026);
  });
});

describe("readableName", () => {
  it("sets capitalized filer names in title case and leaves mixed case alone", () => {
    expect(readableName("TETER TIMOTHY S")).toBe("Teter Timothy S");
    expect(readableName("O'BRIEN DEIRDRE")).toBe("O'Brien Deirdre");
    expect(readableName("SMITH-JONES ANNE")).toBe("Smith-Jones Anne");
    expect(readableName("Blackrock Inc.")).toBe("Blackrock Inc.");
  });
});

describe("perShareDigits", () => {
  it("keeps two decimals for ordinary amounts and up to four for tiny ones", () => {
    expect(perShareDigits(0.52)).toEqual({ min: 2, max: 2 });
    expect(perShareDigits(2.04)).toEqual({ min: 2, max: 2 });
    expect(perShareDigits(0.004)).toEqual({ min: 2, max: 4 });
  });
});

describe("dividendIncome", () => {
  it("gives annual income and yield on cost at the annual rate", () => {
    const income = dividendIncome({ shares: 100, cost: 40 }, 2.04);
    expect(income?.income).toBeCloseTo(204);
    expect(income?.yieldOnCost).toBeCloseTo(0.051);
    expect(dividendIncome({ shares: 100, cost: 40 }, null)).toBeNull();
    expect(dividendIncome({ shares: 100, cost: 40 }, 0)).toBeNull();
  });
});
