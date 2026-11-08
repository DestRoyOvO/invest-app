import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The contract test of the fixture generator: its output must pass yahoo-finance2's own result schemas, with the
// library's validator (the same code that coerces Yahoo's JSON into Dates and numbers). The schemas and the validator
// are internal files of the pinned library version, imported by path; an upgrade that moves them fails here first.
import validateAndCoerce, { type ValidationError } from "../../../node_modules/yahoo-finance2/esm/src/lib/validate/index.js";
import chartSchema from "../../../node_modules/yahoo-finance2/esm/src/modules/chart.schema.js";
import fundamentalsSchema from "../../../node_modules/yahoo-finance2/esm/src/modules/fundamentalsTimeSeries.schema.js";
import optionsSchema from "../../../node_modules/yahoo-finance2/esm/src/modules/options.schema.js";
import quoteSchema from "../../../node_modules/yahoo-finance2/esm/src/modules/quote.schema.js";
import summarySchema from "../../../node_modules/yahoo-finance2/esm/src/modules/quoteSummary-iface.schema.js";
import screenerSchema from "../../../node_modules/yahoo-finance2/esm/src/modules/screener.schema.js";
import searchSchema from "../../../node_modules/yahoo-finance2/esm/src/modules/search.schema.js";
import trendingSchema from "../../../node_modules/yahoo-finance2/esm/src/modules/trendingSymbols.schema.js";

import { buildChart } from "./chart";
import { buildOptions } from "./options";
import { buildQuote } from "./quote";
import { buildScreener, buildTrending } from "./screener";
import { buildSearch } from "./search";
import { securityOf } from "./securities";
import { buildSummary, FIXTURE_SUMMARY_MODULES } from "./summary";
import { buildFundamentals } from "./timeseries";

const SATURDAY = Date.parse("2026-11-07T15:00:00Z");
const WEDNESDAY_SESSION = Date.parse("2026-11-04T17:00:00Z");
const DAY = 86_400_000;

function describeErrors(errors: readonly ValidationError[], depth = 0): string[] {
  return errors.flatMap((error) => [
    `${"  ".repeat(depth)}${error.instancePath ?? ""} ${error.message}${error.params ? ` ${JSON.stringify(error.params).slice(0, 160)}` : ""}`,
    ...describeErrors(error.subErrors ?? [], depth + 1).slice(0, 12),
  ]);
}

/**
 * Schema violations of a value. The validator also coerces what it accepts (epoch seconds or ISO strings to Dates,
 * "1.5" to 1.5), so a value it would have changed is not what the library returns either: it is reported too.
 */
function violations(schema: { definitions: unknown }, key: string, value: unknown): string[] {
  const copy = structuredClone(value);
  const errors = validateAndCoerce(copy, `#/definitions/${key}`, {
    definitions: schema.definitions as never,
    logger: console,
    logObj: () => undefined,
  });
  const problems = describeErrors(errors);
  try {
    expect(copy).toStrictEqual(value);
  } catch {
    problems.push("the validator coerced some values: the output is not in the library's post-validation shape");
  }
  return problems;
}

const QUOTE_SYMBOLS = ["AAPL", "BRK-B", "SPY", "XLK", "^GSPC", "^VIX", "^TNX", "DX-Y.NYB", "EURUSD=X", "USDJPY=X", "GC=F", "BTC-USD", "0700.HK", "^N225", "ABCD", "VFIAX", "E2ELEN"];

function quotesAt(symbols: readonly string[], now: number): Array<Record<string, unknown>> {
  return symbols.map((symbol) => {
    const security = securityOf(symbol);
    const quote = security ? buildQuote(security, now) : null;
    if (!quote) throw new Error(`no quote for ${symbol}`);
    return quote;
  });
}

describe("the contract check", () => {
  it("flags values the library would coerce, such as epoch seconds where it returns a Date", () => {
    const [quote] = quotesAt(["AAPL"], SATURDAY);
    expect(violations(quoteSchema, "QuoteResponseArray", [quote])).toEqual([]);
    const seconds = { ...quote, regularMarketTime: Math.floor((quote.regularMarketTime as Date).getTime() / 1000) };
    expect(violations(quoteSchema, "QuoteResponseArray", [seconds])).not.toEqual([]);
  });
});

describe("fixture output passes yahoo-finance2's result schemas", () => {
  it.each([SATURDAY, WEDNESDAY_SESSION])("quote at %s", (now) => {
    expect(violations(quoteSchema, "QuoteResponseArray", quotesAt(QUOTE_SYMBOLS, now))).toEqual([]);
  });

  it.each([
    ["AAPL", { period1: new Date(SATURDAY - 372 * DAY), interval: "1d" }],
    ["AAPL", { period1: new Date(SATURDAY - 7 * DAY), interval: "5m", includePrePost: true, events: "div|split" }],
    ["NVDA", { period1: new Date(SATURDAY - 1835 * DAY), interval: "1wk", events: "div|split" }],
    ["AAPL", { period1: new Date("1970-01-02T00:00:00Z"), interval: "1mo", events: "div|split" }],
    ["BTC-USD", { period1: new Date(SATURDAY - 12 * DAY), interval: "15m", includePrePost: false }],
    ["EURUSD=X", { period1: new Date(SATURDAY - 35 * DAY), interval: "1d" }],
    ["^TNX", { period1: new Date(SATURDAY - 95 * DAY), interval: "1d" }],
  ])("chart %s %o", (symbol, options) => {
    const chart = buildChart(symbol, options, SATURDAY);
    expect((chart.quotes as unknown[]).length).toBeGreaterThan(0);
    expect(violations(chartSchema, "ChartResultArray", chart)).toEqual([]);
  });

  it.each([
    ["AAPL", FIXTURE_SUMMARY_MODULES],
    ["SPY", ["price", "summaryDetail", "defaultKeyStatistics", "assetProfile", "topHoldings", "fundProfile"]],
    ["^GSPC", ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "calendarEvents", "assetProfile"]],
    ["BTC-USD", ["price", "summaryDetail", "assetProfile"]],
    ["0700.HK", ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "calendarEvents", "assetProfile"]],
    ["ABCD", FIXTURE_SUMMARY_MODULES],
  ])("quoteSummary %s", (symbol, modules) => {
    const summary = buildSummary(symbol, { modules }, SATURDAY);
    expect(Object.keys(summary).length).toBeGreaterThan(0);
    expect(violations(summarySchema, "QuoteSummaryResult", summary)).toEqual([]);
  });

  it.each(["apple", "AAPL", "Federal Reserve", "ABCD"])("search %s", (query) => {
    const result = buildSearch(query, { quotesCount: 8, newsCount: 6 }, SATURDAY);
    expect(violations(searchSchema, "SearchResult", result)).toEqual([]);
  });

  it.each(["day_gainers", "day_losers", "most_actives", "undervalued_large_caps", "growth_technology_stocks", "most_shorted_stocks"])("screener %s", (scrId) => {
    const result = buildScreener({ scrIds: scrId, count: 25 }, undefined, SATURDAY);
    expect(violations(screenerSchema, "ScreenerResult", result)).toEqual([]);
  });

  it("trendingSymbols", () => {
    expect(violations(trendingSchema, "TrendingSymbolsResult", buildTrending({ count: 30 }, SATURDAY))).toEqual([]);
  });

  it.each(["AAPL", "SPY", "^GSPC"])("options %s", (symbol) => {
    const result = buildOptions(symbol, {}, SATURDAY);
    expect(violations(optionsSchema, "OptionsResult", result)).toEqual([]);
  });

  it.each([
    ["annual", "financials"],
    ["quarterly", "financials"],
    ["annual", "cash-flow"],
    ["quarterly", "cash-flow"],
  ])("fundamentalsTimeSeries %s %s", (type, module) => {
    const rows = buildFundamentals("AAPL", { period1: new Date(SATURDAY - 6 * 366 * DAY), type, module }, SATURDAY);
    expect(rows.length).toBeGreaterThan(2);
    expect(violations(fundamentalsSchema, "FundamentalsTimeSeriesResults", rows)).toEqual([]);
  });
});
