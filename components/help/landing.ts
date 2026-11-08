// Where a symbol function lands when the quote has no such tab. FA, ERN, ANR and HDS open ?tab=financials, earnings,
// analysts and ownership; a fund has only the overview and dividends, an index or a currency only the overview
// (components/stock/quote-utils.ts, tabsFor). The page then shows the overview, and TabLandingNote says why.

import { QUOTE_TABS, type QuoteTab } from "@/components/stock/quote-utils";

const FUND_TYPES = new Set(["ETF", "MUTUALFUND"]);

/** The tab a link asked for (?tab=financials) when it is a quote tab this quote does not have; null otherwise. */
export function missingQuoteTab(requested: string | null | undefined, available: readonly QuoteTab[]): QuoteTab | null {
  if (!requested || !(QUOTE_TABS as readonly string[]).includes(requested)) return null;
  return (available as readonly string[]).includes(requested) ? null : (requested as QuoteTab);
}

/** Why the tab is missing: funds have no company tabs; indices, currencies, futures and crypto have only an overview. */
export function landingReason(quoteType: string | null | undefined): "fund" | "overviewOnly" {
  return quoteType && FUND_TYPES.has(quoteType) ? "fund" : "overviewOnly";
}
