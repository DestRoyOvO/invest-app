import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { OverviewQuote, SectorSnapshot } from "@/types/api";

import { SectorCard } from "./HeatmapCards";

// The sector card's count line as server-rendered markup. The overview keeps only the constituents whose quote loaded
// (buildSectors), so a sector can show a single stock.

const prefs = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("@/components/providers/PrefsProvider", async () => {
  const { MESSAGES } = await import("@/lib/i18n/messages");
  return { usePrefs: () => ({ t: MESSAGES[prefs.lang], lang: prefs.lang }) };
});

function quote(symbol: string, changePercent: number): OverviewQuote {
  return {
    symbol,
    name: symbol,
    price: 100,
    change: changePercent,
    changePercent,
    volume: 1_000_000,
    avgVolume: 1_000_000,
    marketCap: 1e11,
    trailingPE: 20,
    fiftyTwoWeekHigh: 120,
    fiftyTwoWeekLow: 80,
  };
}

const sector = (stocks: OverviewQuote[]): SectorSnapshot => ({ key: "technology", changePercent: 1, stocks });

/** The card's text without tags. */
const text = (stocks: OverviewQuote[]) => renderToStaticMarkup(createElement(SectorCard, { sector: sector(stocks) })).replace(/<[^>]+>/g, "");

describe("SectorCard", () => {
  it("counts a single stock in the singular in English, and every other count in the plural", () => {
    prefs.lang = "en";
    expect(text([quote("AAPL", 1)])).toContain("1 stock · 1 up, 0 down");
    expect(text([quote("AAPL", 1), quote("MSFT", -1), quote("NVDA", 2)])).toContain("3 stocks · 2 up, 1 down");
  });

  it("keeps the one Chinese form", () => {
    prefs.lang = "zh";
    expect(text([quote("AAPL", 1)])).toContain("1 只股票");
    expect(text([quote("AAPL", 1), quote("MSFT", -1)])).toContain("2 只股票");
    prefs.lang = "en";
  });
});
