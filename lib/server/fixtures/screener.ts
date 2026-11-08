import "server-only";

import { companyFigures } from "./company";
import { buildQuote, toScreenerQuote, type RawQuote } from "./quote";
import { SCREEN_POOL, type Security } from "./securities";
import { latestCompletedSession, PROFILES, sessionClose } from "./sessions";

// screener() and trendingSymbols() of the fixture data. Predefined screens rank the table's US stocks by the latest
// completed session (gainers, losers, most active) or by fixed company figures (value, growth, short interest), in
// the shape yahoo-finance2 validates for screens (times as epoch seconds). Trending symbols are a fixed list.

export interface FixtureScreenerOptions {
  scrIds?: string;
  count?: number;
  start?: number;
}

interface Row {
  security: Security;
  quote: RawQuote;
}

const TITLES: Readonly<Record<string, string>> = {
  day_gainers: "Day Gainers",
  day_losers: "Day Losers",
  most_actives: "Most Actives",
  undervalued_large_caps: "Undervalued Large Caps",
  growth_technology_stocks: "Growth Technology Stocks",
  most_shorted_stocks: "Most Shorted Stocks",
};

const num = (quote: RawQuote, key: string): number => (typeof quote[key] === "number" ? (quote[key] as number) : 0);

function rank(scrId: string, rows: Row[]): Row[] {
  switch (scrId) {
    case "day_losers":
      return rows.filter((r) => num(r.quote, "regularMarketChangePercent") < 0).sort((a, b) => num(a.quote, "regularMarketChangePercent") - num(b.quote, "regularMarketChangePercent"));
    case "most_actives":
      return [...rows].sort((a, b) => num(b.quote, "regularMarketVolume") - num(a.quote, "regularMarketVolume"));
    case "undervalued_large_caps":
      return rows
        .filter((r) => num(r.quote, "trailingPE") > 0 && num(r.quote, "trailingPE") < 25 && num(r.quote, "marketCap") > 10e9)
        .sort((a, b) => num(a.quote, "trailingPE") - num(b.quote, "trailingPE"));
    case "growth_technology_stocks":
      return rows.filter((r) => r.security.sectorKey === "technology").sort((a, b) => companyFigures(b.security).revenueGrowth - companyFigures(a.security).revenueGrowth);
    case "most_shorted_stocks":
      return [...rows].sort((a, b) => companyFigures(b.security).shortPercentOfFloat - companyFigures(a.security).shortPercentOfFloat);
    case "day_gainers":
    default:
      return rows.filter((r) => num(r.quote, "regularMarketChangePercent") > 0).sort((a, b) => num(b.quote, "regularMarketChangePercent") - num(a.quote, "regularMarketChangePercent"));
  }
}

/** screener(scrId or { scrIds, count, start }) in fixture mode. */
export function buildScreener(scrIdOrOptions: string | FixtureScreenerOptions | undefined, overrides: FixtureScreenerOptions | undefined, now: number): Record<string, unknown> {
  const options: FixtureScreenerOptions = typeof scrIdOrOptions === "string" ? { scrIds: scrIdOrOptions, ...overrides } : { ...scrIdOrOptions };
  const scrId = options.scrIds ?? "day_gainers";
  const count = options.count ?? 5;
  const start = options.start ?? 0;
  const rows = SCREEN_POOL.flatMap((security) => {
    const quote = buildQuote(security, now);
    return quote ? [{ security, quote }] : [];
  });
  const ranked = rank(scrId, rows);
  const page = ranked.slice(start, start + count).map((row) => toScreenerQuote(row.quote));
  const updated = sessionClose(PROFILES.us, latestCompletedSession(PROFILES.us, now));
  return {
    id: scrId,
    title: TITLES[scrId] ?? scrId,
    description: "Synthetic fixture screen used by InvestSeek's automated tests.",
    canonicalName: scrId.toUpperCase(),
    criteriaMeta: {
      includeFields: ["ticker", "companyshortname", "intradayprice", "percentchange", "dayvolume", "intradaymarketcap"],
      size: count,
      offset: start,
      sortField: "percentchange",
      sortType: "DESC",
      quoteType: "EQUITY",
      criteria: [],
      topOperator: "AND",
    },
    rawCriteria: "{}",
    start,
    count: page.length,
    total: ranked.length,
    quotes: page,
    useRecords: false,
    predefinedScr: true,
    versionId: 1,
    creationDate: updated - 86_400_000,
    lastUpdated: updated,
    isPremium: false,
    iconUrl: "",
  };
}

/** A stable list, with a fund and a coin among the stocks, as Yahoo's is. */
const TRENDING = [
  "NVDA", "TSLA", "PLTR", "AAPL", "AMD", "META", "AMZN", "MSFT", "SMCI", "COIN", "GOOGL", "AVGO", "NFLX", "MSTR", "HOOD",
  "BABA", "MU", "INTC", "UBER", "SHOP", "ARM", "ORCL", "BTC-USD", "SPY", "LLY", "JPM", "XOM", "BA", "DIS", "CRM",
];

/** trendingSymbols(region, { count }) in fixture mode. */
export function buildTrending(options: { count?: number } | undefined, now: number): Record<string, unknown> {
  const count = options?.count ?? 5;
  const updated = sessionClose(PROFILES.us, latestCompletedSession(PROFILES.us, now));
  const stamp = new Date(updated);
  const interval = Number(
    `${stamp.getUTCFullYear()}${String(stamp.getUTCMonth() + 1).padStart(2, "0")}${String(stamp.getUTCDate()).padStart(2, "0")}${String(stamp.getUTCHours()).padStart(2, "0")}00`,
  );
  const quotes = TRENDING.slice(0, count).map((symbol) => ({ symbol }));
  return { count: quotes.length, quotes, jobTimestamp: updated, startInterval: interval };
}
