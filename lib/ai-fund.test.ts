import { describe, expect, it } from "vitest";

import { fundBlock, mapFundData, sectorName } from "./ai-fund";

const RAW = {
  topHoldings: {
    stockPosition: 0.9962,
    bondPosition: 0,
    holdings: [
      { symbol: "NVDA", holdingName: "NVIDIA Corp", holdingPercent: 0.076 },
      { symbol: "AAPL", holdingName: "Apple Inc", holdingPercent: 0.077 },
      { symbol: "MSFT", holdingName: "Microsoft Corp", holdingPercent: { raw: 0.059, fmt: "5.90%" } },
      { symbol: "BAD", holdingName: "Bad Row", holdingPercent: null },
    ],
    equityHoldings: { priceToEarnings: 27.1, priceToBook: 4.9 },
    sectorWeightings: [{ realestate: 0.02 }, { technology: 0.312 }, { consumer_cyclical: 0.105 }, { utilities: 0 }],
  },
  fundProfile: { family: "SPDR State Street Global Advisors", categoryName: "Large Blend", legalType: "Exchange Traded Fund", feesExpensesInvestment: { annualReportExpenseRatio: 0.000945 } },
};

describe("fund data", () => {
  it("maps holdings, sector weights and the profile", () => {
    const fund = mapFundData(RAW);
    expect(fund?.holdings.map((h) => h.symbol)).toEqual(["AAPL", "NVDA", "MSFT"]);
    expect(fund?.sectorWeights).toEqual([
      { sector: "technology", weight: 0.312 },
      { sector: "consumer cyclical", weight: 0.105 },
      { sector: "real estate", weight: 0.02 },
    ]);
    expect(fund).toMatchObject({ category: "Large Blend", family: "SPDR State Street Global Advisors", expenseRatio: 0.000945, priceToEarnings: 27.1 });
    expect(sectorName("basic_materials")).toBe("basic materials");
    expect(mapFundData({})).toBeNull();
    expect(mapFundData({ topHoldings: { holdings: [] }, fundProfile: {} })).toBeNull();
  });

  it("writes the fund block, preferring the quote's net expense ratio and noting the top-holdings limit", () => {
    const quote = { expenseRatio: 0.0009, netAssets: 680e9, currency: "USD", ytdReturnPercent: 15.2 } as Parameters<typeof fundBlock>[1];
    const text = fundBlock(mapFundData(RAW), quote);
    expect(text).toContain("Fund profile (Yahoo fund data, may lag by weeks):");
    expect(text).toContain("- category Large Blend; family SPDR State Street Global Advisors; legal type Exchange Traded Fund; expense ratio 0.09% a year; net assets $680.00B; year to date +15.20%");
    expect(text).toContain("- top 3 holdings, 21.2% of assets (Yahoo lists only these, so exposure beyond them is unknown): AAPL Apple Inc 7.7%, NVDA NVIDIA Corp 7.6%, MSFT Microsoft Corp 5.9%");
    expect(text).toContain("- sector weights: technology 31.2%, consumer cyclical 10.5%, real estate 2.0%");
    expect(text).toContain("- holdings: P/E 27.1x, P/B 4.9x, stocks 99.6%, bonds 0.0%");
    expect(fundBlock(null, null)).toBe("Fund profile: not available.");
  });
});
