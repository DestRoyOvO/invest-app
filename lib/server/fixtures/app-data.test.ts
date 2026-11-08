import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Fixture mode promises no network access: a getter that fetches or opens an https request fails this file. (The
// article reader is the app's only node:https user; every other download goes through fetch.)
const networkCalls = vi.hoisted(() => [] as string[]);
vi.mock("node:https", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:https")>();
  const blocked = (...args: unknown[]) => {
    networkCalls.push(`https ${String(args[0])}`);
    throw new Error("node:https request in fixture mode");
  };
  return { ...actual, default: { ...actual, request: blocked, get: blocked }, request: blocked, get: blocked };
});

import { DEFAULT_WATCHLIST, MARKET_BOARD, SECTORS, UNIVERSE_STOCKS } from "@/lib/universe";

import { getFundData } from "../ai-context";
import { fetchArticleText } from "../article";
import { getBoard } from "../board";
import { getCalendar } from "../calendar";
import { clearCache } from "../cache";
import { getDiscover, passesQuality } from "../discover";
import { getChartData, getMarketOverview, getStockDetail } from "../market";
import { getCompanyNews } from "../news";
import { getScreener } from "../screener";
import { getSignalReport } from "../signal-service";
import { getDailyBars, getQuotes, getSparkline, getSummary, searchNews, searchSymbols } from "../yahoo";

import { treasuryFetch } from "./treasury";

// The fixture data through the app's own getters and mappers (mapQuote, mapSummary, normalizeBars, the news scoring,
// the screens, the calendar, the signal engine): every key field the pages show must come out filled. The client is
// the real shared `yf`, switched to fixtures by MARKET_DATA_SOURCE, as in the end-to-end suite.

const SATURDAY = Date.parse("2026-11-07T15:00:00Z");

beforeAll(() => {
  vi.stubEnv("MARKET_DATA_SOURCE", "fixtures");
  vi.useFakeTimers({ now: SATURDAY, toFake: ["Date"] });
  vi.stubGlobal("fetch", async (input: unknown) => {
    networkCalls.push(`fetch ${input instanceof Request ? input.url : String(input)}`);
    throw new Error("fetch in fixture mode");
  });
  clearCache();
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("quotes", () => {
  it("map to complete quotes for the whole overview universe and the board", async () => {
    const symbols = [...UNIVERSE_STOCKS, ...MARKET_BOARD.map((item) => item.symbol), ...SECTORS.map((sector) => sector.etf)];
    const quotes = await getQuotes(symbols);
    expect([...quotes.keys()].sort()).toEqual([...new Set(symbols)].sort());
    for (const quote of quotes.values()) {
      expect(quote.name, quote.symbol).not.toBe(quote.symbol);
      for (const field of ["price", "previousClose", "change", "changePercent", "dayHigh", "dayLow", "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "fiftyDayAverage"] as const) {
        expect(quote[field], `${quote.symbol}.${field}`).toEqual(expect.any(Number));
      }
      expect(quote.marketState, quote.symbol).not.toBeNull();
      expect(quote.regularMarketTime, quote.symbol).toMatch(/^2026-11-0[67]T/);
      expect(quote.currency, quote.symbol).not.toBeNull();
      expect(quote.stale).toBe(false);
    }
    for (const symbol of UNIVERSE_STOCKS) {
      const quote = quotes.get(symbol)!;
      expect(quote.quoteType).toBe("EQUITY");
      for (const field of ["marketCap", "volume", "avgVolume", "sharesOutstanding", "epsTrailingTwelveMonths", "nextEarningsDate", "lastEarningsDate"] as const) {
        expect(quote[field], `${symbol}.${field}`).not.toBeNull();
      }
    }
  });

  it("leave out the reserved not-found symbols", async () => {
    const quotes = await getQuotes(["AAPL", "ZZZZ"]);
    expect([...quotes.keys()]).toEqual(["AAPL"]);
  });
});

describe("summaries, bars and search", () => {
  it("map to a company profile and key statistics", async () => {
    const summary = await getSummary("AAPL");
    expect(summary?.profile).toMatchObject({ name: "Apple Inc.", sector: "Technology", industry: "Consumer Electronics", country: "United States" });
    expect(summary?.profile.summary).toContain("synthetic");
    for (const [key, value] of Object.entries(summary?.stats ?? {})) {
      if (key === "pegRatio") continue;
      expect(value, `stats.${key}`).not.toBeNull();
    }
    expect(Date.parse(summary?.stats.nextEarningsDate ?? "")).toBeGreaterThan(SATURDAY);
    expect(await getSummary("SPY")).toMatchObject({ profile: { name: "SPDR S&P 500 ETF Trust", summary: expect.stringContaining("synthetic") } });
    expect(await getSummary("ZZZZ")).toBeNull();
  });

  it("normalize to daily bars that end at the latest completed session", async () => {
    const bars = await getDailyBars("AAPL", 540);
    expect(bars.length).toBeGreaterThan(360);
    expect(new Date(bars[bars.length - 1].t).toISOString()).toBe("2026-11-06T00:00:00.000Z");
    expect(await getDailyBars("ZZZZ", 540)).toEqual([]);
    const weekly = await getChartData("NVDA", "5y");
    expect(weekly?.interval).toBe("1wk");
    expect(weekly?.bars.length).toBeGreaterThan(250);
    expect(await getChartData("ZZZZ", "1y")).toBeNull();
    expect((await getSparkline("^GSPC")).length).toBeGreaterThan(20);
  });

  it("find tickers by name and stories with fixture links", async () => {
    const results = await searchSymbols("apple");
    expect(results[0]).toMatchObject({ symbol: "AAPL", name: "Apple Inc.", type: "EQUITY" });
    expect(await searchSymbols("ZZZZ")).toEqual([]);
    const news = await searchNews("Apple", 6);
    expect(news).toHaveLength(6);
    for (const item of news) expect(item.link).toMatch(/^https:\/\/example\.com\/fixtures\/news\//);
  });
});

describe("pages", () => {
  it("assemble the market overview without warnings", async () => {
    const overview = await getMarketOverview();
    expect(overview.warnings).toEqual([]);
    expect(overview.board).toHaveLength(MARKET_BOARD.length);
    expect(overview.sectors.every((sector) => sector.stocks.length > 0)).toBe(true);
    expect(overview.movers.gainers.length).toBeGreaterThan(0);
    expect(overview.movers.losers.length).toBeGreaterThan(0);
    expect(overview.news.length).toBeGreaterThan(3);
    const board = await getBoard();
    expect(board.warnings).toEqual([]);
  });

  it("assemble a stock page with company news, and nothing for an unknown symbol", async () => {
    const detail = await getStockDetail("MSFT");
    expect(detail?.warnings).toEqual([]);
    expect(detail?.news.some((item) => item.provenance === "company")).toBe(true);
    expect(await getStockDetail("ZZZZ")).toBeNull();
    const news = await getCompanyNews("NVDA", "NVIDIA Corporation", detail?.profile ?? null);
    expect(news.filter((item) => item.provenance === "company").length).toBeGreaterThan(2);
  });

  it("fill the market-wide screens through the quality filter", async () => {
    for (const screen of ["day_gainers", "day_losers", "most_actives", "trending"] as const) {
      const result = await getDiscover(screen);
      expect(result.quotes.length, screen).toBeGreaterThan(3);
      for (const quote of result.quotes) expect(passesQuality(quote, "us_market", result.minMarketCap)).toBe(true);
    }
  });

  it("put earnings and dividends of the default watchlist in the next two weeks", async () => {
    const calendar = await getCalendar(DEFAULT_WATCHLIST, 14, SATURDAY);
    expect(calendar.missing).toEqual([]);
    const earnings = calendar.events.filter((event) => event.kind === "earnings" && Date.parse(event.at) > SATURDAY).map((event) => event.symbol);
    expect(earnings).toEqual(expect.arrayContaining(["NVDA", "MSFT", "AAPL", "GOOGL", "AMZN"]));
    const weekAhead = calendar.events.filter((event) => event.kind !== "macro" && Date.parse(event.at) < SATURDAY + 8 * 86_400_000);
    expect(weekAhead.length).toBeGreaterThanOrEqual(3);
    expect(calendar.events.some((event) => event.kind === "dividend" && event.symbol === "AAPL" && event.amount !== null)).toBe(true);
  });

  it("score the quant signal and build the screener snapshot", async () => {
    const report = await getSignalReport("AAPL");
    expect(report.status).toBe("ok");
    expect(report.score).toEqual(expect.any(Number));
    const screener = await getScreener("stocks");
    expect(screener.warnings).toEqual([]);
    expect(screener.partial).toEqual([]);
    expect(screener.rows).toHaveLength(UNIVERSE_STOCKS.length);
    expect(screener.rows.every((row) => row.return1m !== null && row.rsi14 !== null)).toBe(true);
  });

  it("give the AI context fund holdings and article text without network access", async () => {
    const fund = await getFundData("XLK");
    expect(fund?.holdings.length).toBe(10);
    expect(fund?.category).toBe("Technology");
    const [story] = await searchNews("Federal Reserve", 1);
    expect(await fetchArticleText(story.link)).toContain("synthetic fixture text");
    expect(await fetchArticleText("https://www.reuters.com/markets/some-story")).toBeNull();
  });

  it("serve the Treasury curve from the fixture CSV through the fetch rates.ts is wired to", async () => {
    const url = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv";
    const response = await treasuryFetch(url, { headers: { accept: "text/csv" } });
    expect(response.status).toBe(200);
    expect((await response.text()).split("\n")[1]).toMatch(/^11\/06\/2026,/);
  });
});

describe("network access", () => {
  // Runs last: every getter above has had its chance to reach the network.
  it("never happened in fixture mode", () => {
    expect(networkCalls).toEqual([]);
  });
});
