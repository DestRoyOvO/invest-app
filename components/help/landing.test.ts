import { describe, expect, it } from "vitest";

import { tabsFor } from "@/components/stock/quote-utils";
import { tpl } from "@/lib/format";
import { MESSAGES } from "@/lib/i18n/messages";

import { landingReason, missingQuoteTab } from "./landing";

describe("where a symbol function lands", () => {
  it("names the tab a fund or an index does not have", () => {
    const fund = tabsFor("ETF");
    for (const tab of ["financials", "earnings", "analysts", "ownership"]) expect(missingQuoteTab(tab, fund)).toBe(tab);
    expect(missingQuoteTab("dividends", fund)).toBeNull();
    expect(missingQuoteTab("dividends", tabsFor("INDEX"))).toBe("dividends");
    // A stock has every tab; no tab or an unknown one is just the overview.
    expect(missingQuoteTab("financials", tabsFor("EQUITY"))).toBeNull();
    expect(missingQuoteTab(null, fund)).toBeNull();
    expect(missingQuoteTab("bogus", fund)).toBeNull();
    expect(missingQuoteTab("overview", fund)).toBeNull();
  });

  it("explains it by quote type, in both languages", () => {
    expect(landingReason("ETF")).toBe("fund");
    expect(landingReason("MUTUALFUND")).toBe("fund");
    expect(landingReason("INDEX")).toBe("overviewOnly");
    expect(landingReason("CRYPTOCURRENCY")).toBe("overviewOnly");
    expect(tpl(MESSAGES.en.help.landing.fund, { symbol: "SPY", tab: MESSAGES.en.stock.tabs.financials })).toBe(
      "SPY is a fund, and funds have no Financials tab. Showing the overview.",
    );
    for (const lang of ["en", "zh"] as const) {
      for (const text of Object.values(MESSAGES[lang].help.landing)) {
        expect(text).toContain("{symbol}");
        expect(text).toContain("{tab}");
        expect(text).not.toMatch(/—/);
      }
    }
  });
});
