import "server-only";

import type YahooFinance from "yahoo-finance2";

import { readEnv } from "../env";

import { buildChart, type FixtureChartOptions } from "./chart";
import { buildOptions, type FixtureOptionsQuery } from "./options";
import { buildQuote, type RawQuote } from "./quote";
import { buildScreener, buildTrending, type FixtureScreenerOptions } from "./screener";
import { buildSearch, type FixtureSearchOptions } from "./search";
import { securityOf } from "./securities";
import { buildSummary, type FixtureSummaryOptions } from "./summary";
import { buildFundamentals, type FixtureFundamentalsOptions } from "./timeseries";

// The seam between the app and its market data. lib/server/yahoo.ts wraps the shared yahoo-finance2 client with
// withMarketDataSource(), and every Yahoo method the app uses decides at call time, from MARKET_DATA_SOURCE, whether
// the real client or the fixture generator answers. One build serves both modes, and the fixture methods accept the
// same arguments and resolve to the same shapes as the library's (after its validation and type coercion).

type YahooClient = InstanceType<typeof YahooFinance>;

/** The yahoo-finance2 methods the app calls (on this branch and the feature branches merged into it). */
export const DISPATCHED_METHODS = ["quote", "chart", "quoteSummary", "search", "screener", "trendingSymbols", "options", "fundamentalsTimeSeries"] as const;

export type DispatchedMethod = (typeof DISPATCHED_METHODS)[number];

interface QuoteOptions {
  return?: "array" | "object" | "map";
  fields?: readonly string[];
}

function pickFields(quote: RawQuote, fields: readonly string[] | undefined): RawQuote {
  if (!fields?.length) return quote;
  const kept: RawQuote = { symbol: quote.symbol, quoteType: quote.quoteType, language: quote.language, region: quote.region, triggerable: quote.triggerable };
  for (const field of fields) if (field in quote) kept[field] = quote[field];
  return kept;
}

/** The fixture generator behind each dispatched method, with the library's signatures and defaults. */
export const fixtureClient = {
  async quote(query: string | readonly string[], options?: QuoteOptions): Promise<unknown> {
    const now = Date.now();
    const symbols = (typeof query === "string" ? query.split(",") : [...query]).map((s) => s.trim()).filter(Boolean);
    // Symbols Yahoo does not know are left out, so a single unknown symbol resolves to undefined.
    const quotes = symbols.flatMap((symbol) => {
      const security = securityOf(symbol);
      const quote = security ? buildQuote(security, now) : null;
      return quote ? [pickFields(quote, options?.fields)] : [];
    });
    switch (options?.return) {
      case "array":
        return quotes;
      case "object":
        return Object.fromEntries(quotes.map((q) => [q.symbol as string, q]));
      case "map":
        return new Map(quotes.map((q) => [q.symbol as string, q]));
      default:
        return typeof query === "string" ? quotes[0] : quotes;
    }
  },
  async chart(symbol: string, options: FixtureChartOptions): Promise<unknown> {
    return buildChart(symbol, options, Date.now());
  },
  async quoteSummary(symbol: string, options?: FixtureSummaryOptions): Promise<unknown> {
    return buildSummary(symbol, options, Date.now());
  },
  async search(query: string, options?: FixtureSearchOptions): Promise<unknown> {
    return buildSearch(query, options, Date.now());
  },
  async screener(scrIdOrOptions?: string | FixtureScreenerOptions, overrides?: FixtureScreenerOptions): Promise<unknown> {
    return buildScreener(scrIdOrOptions, overrides, Date.now());
  },
  async trendingSymbols(region: string, options?: { count?: number }): Promise<unknown> {
    void region;
    return buildTrending(options, Date.now());
  },
  async options(symbol: string, query?: FixtureOptionsQuery): Promise<unknown> {
    return buildOptions(symbol, query, Date.now());
  },
  async fundamentalsTimeSeries(symbol: string, options: FixtureFundamentalsOptions): Promise<unknown> {
    return buildFundamentals(symbol, options, Date.now());
  },
} satisfies Record<DispatchedMethod, (...args: never[]) => Promise<unknown>>;

/** True while MARKET_DATA_SOURCE=fixtures. */
export function usesFixtures(): boolean {
  return readEnv().marketDataSource === "fixtures";
}

/**
 * The client the app uses: the real client's properties, with each dispatched method answering from the fixture
 * generator while MARKET_DATA_SOURCE=fixtures and from the real client otherwise. The methods are own, writable
 * properties, so tests can still spy on yf.quote and friends.
 */
export function withMarketDataSource(real: YahooClient): YahooClient {
  const client = Object.create(real) as YahooClient;
  for (const name of DISPATCHED_METHODS) {
    const fixture = fixtureClient[name] as (...args: unknown[]) => Promise<unknown>;
    const method = (...args: unknown[]): Promise<unknown> => {
      if (usesFixtures()) return fixture(...args);
      return (real[name] as unknown as (...a: unknown[]) => Promise<unknown>).apply(real, args);
    };
    Object.defineProperty(client, name, { value: method, writable: true, configurable: true, enumerable: true });
  }
  return client;
}
