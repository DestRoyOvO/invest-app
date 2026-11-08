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

import { ETF_UNIVERSE } from "@/lib/screens";
import { DEFAULT_WATCHLIST, MARKET_BOARD, SECTORS, UNIVERSE_STOCKS, WORLD_BOARD } from "@/lib/universe";
import type { Bar, Quote } from "@/types/api";

import { buildAnalyzeContext, buildChatContext, getFundData } from "../ai-context";
import { fetchArticleText } from "../article";
import { getBoard } from "../board";
import { getCalendar } from "../calendar";
import { clearCache } from "../cache";
import { DISCOVER_SCREENS, getDiscover, passesQuality } from "../discover";
import { getAnalystActivity, getEarningsDetail } from "../earnings";
import { getHistory } from "../history";
import { getChartData, getMarketOverview, getStockDetail, getStockNews } from "../market";
import { getCompanyNews, getMarketNews, getSectorNews } from "../news";
import { getImpliedMove } from "../options";
import { getProfiles } from "../profiles";
import { getYieldCurve } from "../rates";
import { getDividends, getFinancials, getOwnership } from "../research";
import { getFactorProfile, getScreener } from "../screener";
import { getSignalReport } from "../signal-service";
import { getWorldMarkets } from "../world";
import { getDailyBars, getQuotes, getSparkline, getSummary, searchNews, searchSymbols } from "../yahoo";

import { treasuryFetch } from "./treasury";

// The fixture data through the app's own getters and mappers (mapQuote, mapSummary, normalizeBars, the news scoring,
// the screens, the calendar, the signal engine, and the research, markets and AI getters of wave 2): every key field
// the pages show must come out filled and agree with the quote. The client is the real shared `yf`, switched to
// fixtures by MARKET_DATA_SOURCE, as in the end-to-end suite, and the Treasury curve comes through rates.ts's default
// fetch.

const SATURDAY = Date.parse("2026-11-07T15:00:00Z");
const DAY_MS = 86_400_000;

async function quoteOf(symbol: string): Promise<Quote> {
  const quote = (await getQuotes([symbol])).get(symbol);
  if (!quote) throw new Error(`No fixture quote for ${symbol}`);
  return quote;
}

/** The session date of a bar (or event) time in New York, YYYY-MM-DD. */
function nyDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(ms);
}

/** OHLC bars that make sense: low <= open, close <= high, positive prices, times strictly ascending. */
function expectSaneBars(bars: readonly Bar[], label: string): void {
  expect(bars.length, label).toBeGreaterThan(0);
  bars.forEach((bar, i) => {
    expect(bar.l, `${label} bar ${i}`).toBeGreaterThan(0);
    expect(bar.l, `${label} bar ${i}`).toBeLessThanOrEqual(Math.min(bar.o, bar.c) + 1e-9);
    expect(bar.h, `${label} bar ${i}`).toBeGreaterThanOrEqual(Math.max(bar.o, bar.c) - 1e-9);
    if (i > 0) expect(bar.t, `${label} bar ${i}`).toBeGreaterThan(bars[i - 1].t);
  });
}

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
    // Saturday: the cash session is closed, and every instrument of the shell's board has a month of closes.
    expect(board.marketState).toBe("CLOSED");
    expect(board.board.map((item) => item.quote.symbol)).toEqual(MARKET_BOARD.map((item) => item.symbol));
    for (const item of board.board) expect(item.spark.length, item.quote.symbol).toBeGreaterThan(15);
  });

  it("assemble a stock page and its company news, and nothing for an unknown symbol", async () => {
    const detail = await getStockDetail("MSFT");
    expect(detail?.warnings).toEqual([]);
    expect(await getStockDetail("ZZZZ")).toBeNull();
    // Through the news getter rather than StockDetail.news, which wave2/quote moves to its own request.
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

describe("quote page research", () => {
  it("map the earnings modules to the next report, its consensus and the reported quarters", async () => {
    const [detail, quote] = await Promise.all([getEarningsDetail("AAPL"), quoteOf("AAPL")]);
    expect(detail).not.toBeNull();
    const earnings = detail!;
    expect(earnings).toMatchObject({ symbol: "AAPL", financialCurrency: "USD", epsCurrency: "USD", nextDateEstimated: expect.any(Boolean) });
    // AAPL reports six sessions after the latest one (Friday 2026-11-06), the same date the quote has.
    expect(nyDate(Date.parse(earnings.nextDate!))).toBe("2026-11-16");
    expect(earnings.nextDate).toBe(quote.nextEarningsDate);
    expect(earnings.nextTiming === null || ["pre", "post", "intraday"].includes(earnings.nextTiming!)).toBe(true);

    const consensus = earnings.consensus!;
    expect(consensus.epsAvg).toBeGreaterThan(0);
    expect(consensus.epsLow!).toBeLessThanOrEqual(consensus.epsAvg!);
    expect(consensus.epsHigh!).toBeGreaterThanOrEqual(consensus.epsAvg!);
    expect(consensus.revenueAvg).toBeGreaterThan(0);

    expect(earnings.history.length).toBeGreaterThanOrEqual(4);
    expect(earnings.history.length).toBeLessThanOrEqual(5);
    for (const [i, quarter] of earnings.history.entries()) {
      expect(quarter.period, `quarter ${i}`).toMatch(/^[1-4]Q20\d\d$/);
      expect(quarter.epsActual, `quarter ${i}`).toEqual(expect.any(Number));
      expect(quarter.epsEstimate, `quarter ${i}`).toEqual(expect.any(Number));
      expect(quarter.surprise!, `quarter ${i}`).toBeCloseTo((quarter.epsActual! - quarter.epsEstimate!) / Math.abs(quarter.epsEstimate!), 2);
      // Reported 15 to 60 days after the quarter ended, before today.
      const lag = (Date.parse(quarter.reportedAt!) - Date.parse(quarter.periodEnd!)) / DAY_MS;
      expect(lag, `quarter ${i}`).toBeGreaterThanOrEqual(15);
      expect(lag, `quarter ${i}`).toBeLessThanOrEqual(61);
      expect(Date.parse(quarter.reportedAt!)).toBeLessThan(SATURDAY);
      if (i > 0) expect(Date.parse(quarter.periodEnd!)).toBeGreaterThan(Date.parse(earnings.history[i - 1].periodEnd!));
    }
    // The trailing EPS of the quote is the sum of the four latest reported quarters.
    const lastFour = earnings.history.slice(-4).reduce((sum, quarter) => sum + quarter.epsActual!, 0);
    expect(lastFour).toBeCloseTo(quote.epsTrailingTwelveMonths!, 1);

    expect(earnings.estimates.map((estimate) => estimate.period)).toEqual(expect.arrayContaining(["0q", "+1q", "0y", "+1y"]));
    for (const estimate of earnings.estimates) {
      expect(estimate.epsAvg, estimate.period).toEqual(expect.any(Number));
      expect(estimate.analysts, estimate.period).toBeGreaterThan(0);
      expect(estimate.epsTrend.current, estimate.period).toBe(estimate.epsAvg);
    }
  });

  it("map the analyst modules to monthly ratings, price targets and the latest actions", async () => {
    const [activity, quote] = await Promise.all([getAnalystActivity("AAPL"), quoteOf("AAPL")]);
    expect(activity).not.toBeNull();
    const analysts = activity!;
    expect(analysts.trend.map((row) => row.period)).toEqual(["0m", "-1m", "-2m", "-3m"]);
    for (const row of analysts.trend) expect(row.strongBuy + row.buy + row.hold + row.sell + row.strongSell, row.period).toBeGreaterThan(0);
    expect(analysts.targetLow!).toBeLessThan(analysts.targetMean!);
    expect(analysts.targetHigh!).toBeGreaterThan(analysts.targetMean!);
    expect(analysts.numberOfAnalysts).toBeGreaterThan(10);
    expect(analysts.recommendationMean!).toBeGreaterThanOrEqual(1);
    expect(analysts.recommendationMean!).toBeLessThanOrEqual(5);
    expect(["strong_buy", "buy", "hold", "underperform", "sell"]).toContain(analysts.recommendationKey);
    expect(analysts.currentPrice).toBe(quote.price);

    expect(analysts.actions.length).toBeGreaterThan(0);
    expect(analysts.actions.length).toBeLessThanOrEqual(30);
    for (const [i, action] of analysts.actions.entries()) {
      expect(action.firm, `action ${i}`).not.toBe("");
      expect(Date.parse(action.date), `action ${i}`).toBeGreaterThanOrEqual(SATURDAY - 90 * DAY_MS);
      expect(Date.parse(action.date), `action ${i}`).toBeLessThanOrEqual(SATURDAY + DAY_MS);
      if (i > 0) expect(action.date <= analysts.actions[i - 1].date, `action ${i} is newest first`).toBe(true);
    }
  });

  it("price the move the options imply into a report within 30 days", async () => {
    const [move, quote] = await Promise.all([getImpliedMove("NVDA"), quoteOf("NVDA")]);
    expect(move).not.toBeNull();
    const implied = move!;
    expect(implied.report.at).toBe(quote.nextEarningsDate);
    expect(implied.price).toBe(quote.price);
    expect(implied.currency).toBe("USD");
    // The first expiry after the report, a few days out.
    expect(implied.expiry.slice(0, 10) >= nyDate(Date.parse(implied.report.at))).toBe(true);
    expect(implied.daysToExpiry).toBeGreaterThanOrEqual(0);
    expect(implied.daysToExpiry).toBeLessThanOrEqual(30);
    expect(Math.abs(implied.strike - implied.price) / implied.price).toBeLessThan(0.05);
    expect(implied.callPrice).toBeGreaterThan(0);
    expect(implied.putPrice).toBeGreaterThan(0);
    expect(implied.straddle).toBeCloseTo(implied.callPrice + implied.putPrice, 6);
    expect(implied.move).toBeCloseTo(implied.straddle / implied.price, 6);
    expect(implied.move).toBeGreaterThan(0.01);
    expect(implied.move).toBeLessThan(0.25);
    expect(["mid", "last", "mixed"]).toContain(implied.basis);
  });

  it("build income and cash flow statements that agree with the earnings and the quote", async () => {
    const [statements, earnings, quote] = await Promise.all([getFinancials("AAPL"), getEarningsDetail("AAPL"), quoteOf("AAPL")]);
    expect(statements).not.toBeNull();
    const financials = statements!;
    expect(financials.currency).toBe("USD");
    expect(financials.annual.length).toBeGreaterThanOrEqual(3);
    expect(financials.annual.length).toBeLessThanOrEqual(4);
    expect(financials.quarterly.length).toBeGreaterThanOrEqual(4);
    expect(financials.quarterly.length).toBeLessThanOrEqual(5);
    for (const [label, periods] of [["annual", financials.annual], ["quarterly", financials.quarterly]] as const) {
      for (const [i, period] of periods.entries()) {
        const at = `${label} ${period.end}`;
        if (i > 0) expect(period.end > periods[i - 1].end, at).toBe(true);
        expect(period.revenue, at).toBeGreaterThan(0);
        expect(period.grossMargin!, at).toBeCloseTo(period.grossProfit! / period.revenue!, 6);
        expect(period.operatingMargin!, at).toBeCloseTo(period.operatingIncome! / period.revenue!, 6);
        expect(period.netMargin!, at).toBeCloseTo(period.netIncome! / period.revenue!, 6);
        expect(period.grossMargin!, at).toBeGreaterThan(period.operatingMargin!);
        expect(period.capitalExpenditure!, at).toBeLessThan(0);
        expect(period.freeCashFlow, at).toBe(period.operatingCashFlow! + period.capitalExpenditure!);
        expect(period.dilutedEps, at).toEqual(expect.any(Number));
      }
    }
    // The latest quarters are the reported quarters of the earnings history, and four of them make the trailing EPS.
    const reported = earnings!.history.map((quarter) => quarter.periodEnd!.slice(0, 10));
    expect(financials.quarterly.slice(-4).map((period) => period.end)).toEqual(reported.slice(-4));
    const lastFour = financials.quarterly.slice(-4).reduce((sum, period) => sum + period.dilutedEps!, 0);
    expect(lastFour).toBeCloseTo(quote.epsTrailingTwelveMonths!, 1);
    // A fiscal year is the sum of its quarters: the latest full year has about four times a quarter's revenue.
    const lastYear = financials.annual.at(-1)!;
    const quarterRevenue = financials.quarterly.at(-1)!.revenue!;
    expect(lastYear.revenue! / quarterRevenue).toBeGreaterThan(3);
    expect(lastYear.revenue! / quarterRevenue).toBeLessThan(5);
  });

  it("keep the margins of every stock's statements in order, moving a little from period to period", { timeout: 30_000 }, async () => {
    for (const symbol of UNIVERSE_STOCKS) {
      const financials = await getFinancials(symbol);
      expect(financials, symbol).not.toBeNull();
      for (const periods of [financials!.annual, financials!.quarterly]) {
        for (const period of periods) {
          const at = `${symbol} ${period.end}`;
          // Net income is below operating income (taxes and other items cost), which is below gross profit.
          if (period.netIncome! > 0) expect(period.netMargin!, at).toBeLessThan(period.operatingMargin!);
          expect(period.operatingMargin!, at).toBeLessThan(period.grossMargin!);
          expect(period.ebitda!, at).toBeGreaterThan(period.operatingIncome!);
        }
        // Not fixed ratios of revenue: margins and capital spending move between periods.
        expect(new Set(periods.map((period) => period.grossMargin!.toFixed(4))).size, symbol).toBeGreaterThan(1);
        expect(new Set(periods.map((period) => (period.capitalExpenditure! / period.revenue!).toFixed(4))).size, symbol).toBeGreaterThan(1);
      }
      // Earnings grow about as fast as revenue: over the four fiscal years the net margin changes by a fraction, and
      // revenue that grew by a third comes with higher earnings.
      const [first, last] = [financials!.annual[0], financials!.annual.at(-1)!];
      if (first.netIncome! > 0 && last.netIncome! > 0) {
        expect(last.netMargin! / first.netMargin!, symbol).toBeGreaterThan(0.75);
        expect(last.netMargin! / first.netMargin!, symbol).toBeLessThan(1.35);
        if (last.revenue! / first.revenue! > 1.3) expect(last.dilutedEps!, symbol).toBeGreaterThan(first.dilutedEps!);
      }
    }
  });

  it("sum ten years of dividends and announce the next payment", async () => {
    const [history, quote] = await Promise.all([getDividends("AAPL"), quoteOf("AAPL")]);
    expect(history).not.toBeNull();
    const dividends = history!;
    expect(dividends.currency).toBe("USD");
    expect(dividends.frequency).toBe("quarterly");
    expect(dividends.payments.length).toBeGreaterThanOrEqual(36);
    expect(dividends.payments.length).toBeLessThanOrEqual(41);
    for (const [i, payment] of dividends.payments.entries()) {
      expect(payment.amount, payment.exDate).toBeGreaterThan(0);
      expect(payment.exDate < "2026-11-07", payment.exDate).toBe(true);
      if (i > 0) expect(payment.exDate > dividends.payments[i - 1].exDate, payment.exDate).toBe(true);
    }
    const lastYear = dividends.payments.filter((payment) => Date.parse(payment.exDate) > SATURDAY - 365 * DAY_MS);
    expect(dividends.trailingAnnual!).toBeCloseTo(lastYear.reduce((sum, payment) => sum + payment.amount, 0), 3);
    // Full years of four payments each, and the current year still in progress.
    for (const year of dividends.years.filter((entry) => !entry.partial)) expect(year.payments, String(year.year)).toBe(4);
    expect(dividends.years.at(-1)).toMatchObject({ year: 2026, partial: true });
    expect(dividends.growth5y!).toBeGreaterThan(0);
    expect(dividends.growth5y!).toBeLessThan(0.15);
    // The yield is the forward rate over the price, and AAPL goes ex-dividend three sessions ahead.
    expect(dividends.yieldBasis).toBe("forward");
    expect(dividends.forwardAnnual).toBe(quote.dividendRate);
    expect(dividends.yield!).toBeCloseTo(quote.dividendRate! / quote.price!, 6);
    expect(dividends.next).toEqual({ exDate: "2026-11-11", amount: expect.any(Number) });
    expect(dividends.next!.amount!).toBeCloseTo(dividends.forwardAnnual! / 4, 2);
    expect(dividends.nextPayDate! > dividends.next!.exDate).toBe(true);
  });

  it("map the ownership modules to the holder breakdown, insider activity and the largest institutions", async () => {
    const ownership = await getOwnership("AAPL");
    expect(ownership).not.toBeNull();
    const { breakdown, insiderSummary, insiderTrades, institutions } = ownership!;
    expect(breakdown!.insiders!).toBeGreaterThan(0);
    expect(breakdown!.insiders!).toBeLessThan(0.2);
    expect(breakdown!.institutions!).toBeGreaterThan(0.3);
    expect(breakdown!.institutions!).toBeLessThan(1);
    expect(breakdown!.institutionsFloat!).toBeGreaterThanOrEqual(breakdown!.institutions!);
    expect(breakdown!.institutionsCount).toBeGreaterThan(100);
    expect(insiderSummary!.netShares).toBe(insiderSummary!.buyShares! - insiderSummary!.sellShares!);
    expect(insiderSummary!.buyCount! + insiderSummary!.sellCount!).toBeGreaterThan(0);

    expect(insiderTrades.length).toBeGreaterThan(0);
    expect(insiderTrades.length).toBeLessThanOrEqual(20);
    for (const [i, trade] of insiderTrades.entries()) {
      expect(trade.name, `trade ${i}`).not.toBe("");
      expect(trade.date! <= "2026-11-07", `trade ${i}`).toBe(true);
      if (i > 0) expect(trade.date! <= insiderTrades[i - 1].date!, `trade ${i} is newest first`).toBe(true);
    }
    expect(institutions.length).toBeGreaterThan(0);
    expect(institutions.length).toBeLessThanOrEqual(10);
    for (const [i, holder] of institutions.entries()) {
      expect(holder.name, `holder ${i}`).not.toBe("");
      expect(holder.pctHeld!, `holder ${i}`).toBeGreaterThan(0);
      expect(holder.shares!, `holder ${i}`).toBeGreaterThan(0);
      if (i > 0) expect(holder.pctHeld!, `holder ${i} is largest first`).toBeLessThanOrEqual(institutions[i - 1].pctHeld!);
    }
  });

  it("give funds dividends but no statements, earnings, analysts or insiders, and unknown symbols nothing", async () => {
    expect(await getEarningsDetail("SPY")).toBeNull();
    expect(await getAnalystActivity("SPY")).toBeNull();
    expect(await getFinancials("SPY")).toBeNull();
    expect(await getOwnership("SPY")).toBeNull();
    expect(await getImpliedMove("SPY")).toBeNull();
    const fund = await getDividends("SPY");
    expect(fund).toMatchObject({ frequency: "quarterly", yieldBasis: "forward" });
    expect(fund!.payments.length).toBeGreaterThan(30);
    for (const getter of [getEarningsDetail, getAnalystActivity, getImpliedMove, getFinancials, getDividends, getOwnership]) {
      expect(await getter("ZZZZ"), getter.name).toBeNull();
    }
  });
});

describe("chart ranges", () => {
  it("show the latest session in 5-minute bars with its extended hours", async () => {
    const [chart, quote] = await Promise.all([getChartData("AAPL", "1d"), quoteOf("AAPL")]);
    expect(chart).toMatchObject({ interval: "5m", intraday: true, timezone: "America/New_York", previousClose: quote.previousClose });
    const bars = chart!.bars;
    expectSaneBars(bars, "1d");
    expect(new Set(bars.map((bar) => nyDate(bar.t)))).toEqual(new Set(["2026-11-06"]));
    expect(new Set(bars.map((bar) => bar.session))).toEqual(new Set(["pre", "regular", "post"]));
    // The regular session opens at the day's open, closes at its close and touches its high and low.
    const regular = bars.filter((bar) => bar.session === "regular");
    expect(regular.length).toBe(78);
    expect(regular[0].o).toBeCloseTo(quote.open!, 2);
    expect(regular.at(-1)!.c).toBeCloseTo(quote.price!, 2);
    expect(Math.max(...regular.map((bar) => bar.h))).toBeCloseTo(quote.dayHigh!, 2);
    expect(Math.min(...regular.map((bar) => bar.l))).toBeCloseTo(quote.dayLow!, 2);
  });

  it("show five sessions in 15-minute bars", async () => {
    const chart = await getChartData("MSFT", "5d");
    expect(chart).toMatchObject({ interval: "15m", intraday: true });
    expectSaneBars(chart!.bars, "5d");
    expect([...new Set(chart!.bars.map((bar) => nyDate(bar.t)))]).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
  });

  it("show the year to date in daily bars, five years in weekly and the whole history in monthly bars", async () => {
    const quote = await quoteOf("AAPL");
    const ytd = (await getChartData("AAPL", "ytd"))!;
    expect(ytd).toMatchObject({ interval: "1d", intraday: false });
    expectSaneBars(ytd.bars, "ytd");
    expect(new Date(ytd.bars[0].t).toISOString().slice(0, 10)).toBe("2026-01-02");
    expect(new Date(ytd.bars.at(-1)!.t).toISOString().slice(0, 10)).toBe("2026-11-06");
    expect(ytd.bars.length).toBeGreaterThan(200);
    expect(ytd.bars.at(-1)!.c).toBeCloseTo(quote.price!, 2);
    // AAPL goes ex-dividend once a quarter.
    expect(ytd.dividends.length).toBeGreaterThanOrEqual(3);

    const fiveYears = (await getChartData("AAPL", "5y"))!;
    expect(fiveYears.interval).toBe("1wk");
    expectSaneBars(fiveYears.bars, "5y");
    expect(fiveYears.bars.length).toBeGreaterThan(250);
    expect(fiveYears.bars.length).toBeLessThan(265);
    expect(fiveYears.bars.at(-1)!.c).toBeCloseTo(quote.price!, 2);
    expect(fiveYears.dividends.length).toBeGreaterThanOrEqual(19);
    for (const dividend of fiveYears.dividends) expect(dividend.amount).toBeGreaterThan(0);

    const max = (await getChartData("AAPL", "max"))!;
    expect(max.interval).toBe("1mo");
    expectSaneBars(max.bars, "max");
    expect(max.bars.length).toBeGreaterThan(12 * 10);
    expect(max.bars.at(-1)!.c).toBeCloseTo(quote.price!, 2);
    expect(max.splits).toEqual([expect.objectContaining({ numerator: 4, denominator: 1, ratio: "4:1" })]);
    expect(new Date(max.splits[0].t).toISOString().slice(0, 7)).toBe("2020-08");
  });

  it("roll a 24-hour window for markets that trade around the clock", async () => {
    const chart = await getChartData("BTC-USD", "1d");
    expect(chart).toMatchObject({ interval: "5m", intraday: true, continuous: true });
    expectSaneBars(chart!.bars, "BTC-USD 1d");
    const span = chart!.bars.at(-1)!.t - chart!.bars[0].t;
    expect(span).toBeGreaterThan(20 * 60 * 60 * 1000);
    expect(span).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(chart!.previousClose).toEqual(expect.any(Number));
  });
});

describe("markets, portfolio and AI getters", () => {
  it("serve the Treasury curve from the fixture data through rates.ts's default fetch", async () => {
    const [curve, tnx] = await Promise.all([getYieldCurve(), quoteOf("^TNX")]);
    expect(curve).toMatchObject({ stale: false, warnings: [] });
    expect(curve.current.date).toBe("2026-11-06");
    expect(curve.tenors).toEqual(expect.arrayContaining(["3M", "2Y", "5Y", "10Y", "30Y"]));
    expect(curve.current.yields).toHaveLength(curve.tenors.length);
    for (const value of curve.current.yields) {
      expect(value).toBeGreaterThan(0.5);
      expect(value).toBeLessThan(8);
    }
    expect(curve.monthAgo!.date).toBe("2026-10-06");
    expect(curve.yearAgo!.date.slice(0, 7)).toBe("2025-11");
    // The same curve model as ^TNX, the 10-year yield in percent.
    const tenYear = curve.current.yields[curve.tenors.indexOf("10Y")]!;
    expect(Math.abs(tenYear - tnx.price!)).toBeLessThan(0.05);
    const twoYear = curve.current.yields[curve.tenors.indexOf("2Y")]!;
    const twosTens = curve.spreads.find((spread) => spread.key === "2s10s")!;
    expect(twosTens.bp!).toBeCloseTo((tenYear - twoYear) * 100, 0);
    expect(twosTens.history.length).toBeGreaterThan(200);
    expect(curve.spreads.map((spread) => spread.key)).toEqual(["2s10s", "3m10y"]);
  });

  it("assemble the world board with a quote and a month of closes per instrument", async () => {
    const world = await getWorldMarkets();
    expect(world).toMatchObject({ missing: [], warnings: [], staleSince: null });
    expect(world.rows.map((row) => row.symbol)).toEqual(WORLD_BOARD.map((item) => item.symbol));
    for (const row of world.rows) {
      expect(row.price, row.symbol).toBeGreaterThan(0);
      expect(row.changePercent, row.symbol).toEqual(expect.any(Number));
      expect(row.change!, row.symbol).toBeCloseTo((row.price! * row.changePercent!) / (100 + row.changePercent!), 1);
      expect(row.marketState, row.symbol).not.toBeNull();
      expect(row.spark.length, row.symbol).toBeGreaterThan(15);
      expect(row.spark.at(-1)!, row.symbol).toBeCloseTo(row.price!, 1);
      expect(row.stale, row.symbol).toBe(false);
    }
  });

  it("fill the ETF screener and every discover screen", async () => {
    const etfs = await getScreener("etfs");
    expect(etfs).toMatchObject({ universe: "etfs", warnings: [], partial: [] });
    expect(etfs.rows.map((row) => row.symbol).sort()).toEqual([...ETF_UNIVERSE].sort());
    for (const row of etfs.rows) {
      expect(row.quoteType, row.symbol).toBe("ETF");
      for (const field of ["price", "expenseRatio", "netAssets", "return1m", "return6m", "rsi14"] as const) expect(row[field], `${row.symbol}.${field}`).toEqual(expect.any(Number));
    }
    for (const screen of DISCOVER_SCREENS) {
      const result = await getDiscover(screen);
      expect(result.scanned, screen).toBeGreaterThan(0);
      expect(result.quotes.length, screen).toBeGreaterThan(0);
      for (const quote of result.quotes) expect(passesQuality(quote, "us_market", result.minMarketCap), `${screen} ${quote.symbol}`).toBe(true);
    }
  });

  it("align the price history of the positions for the portfolio charts and risk", async () => {
    const history = await getHistory(["AAPL", "MSFT", "SPY", "ZZZZ"], "1y", SATURDAY);
    expect(history).toMatchObject({ range: "1y", missing: ["ZZZZ"], degraded: false });
    expect(history.dates.length).toBeGreaterThan(245);
    expect(history.dates.length).toBeLessThan(260);
    expect(new Date(history.dates.at(-1)!).toISOString().slice(0, 10)).toBe("2026-11-06");
    for (const symbol of ["AAPL", "MSFT", "SPY"]) {
      const closes = history.closes[symbol];
      expect(closes, symbol).toHaveLength(history.dates.length);
      expect(closes.every((close) => close !== null && close > 0), symbol).toBe(true);
      expect(closes.at(-1)!, symbol).toBeCloseTo((await quoteOf(symbol)).price!, 2);
    }
  });

  it("give profiles for exposure, sector and market headlines, company news and factor profiles", async () => {
    const profiles = await getProfiles(["AAPL", "SPY", "0700.HK", "ZZZZ"]);
    expect(profiles).toMatchObject({ missing: ["ZZZZ"], degraded: false });
    expect(profiles.profiles.AAPL).toMatchObject({ name: "Apple Inc.", sector: "Technology", country: "United States", currency: "USD" });
    expect(profiles.profiles["0700.HK"]).toMatchObject({ currency: "HKD", sector: expect.any(String) });
    expect(profiles.profiles.SPY.name).toBe("SPDR S&P 500 ETF Trust");

    for (const [feed, provenance] of [[await getSectorNews("technology"), "sector"], [await getMarketNews(), "market"]] as const) {
      expect(feed.length, provenance).toBeGreaterThan(3);
      for (const item of feed) {
        expect(item.provenance, item.title).toBe(provenance);
        expect(item.link, item.title).toMatch(/^https:\/\/example\.com\/fixtures\/news\//);
      }
    }
    const news = await getStockNews("AAPL");
    expect(news!.filter((item) => item.provenance === "company").length).toBeGreaterThan(2);
    expect(await getStockNews("ZZZZ")).toBeNull();

    const own = await getFactorProfile("AAPL");
    expect(own).toMatchObject({ symbol: "AAPL", inUniverse: true, universeSize: UNIVERSE_STOCKS.length });
    const outside = await getFactorProfile("0700.HK");
    expect(outside).toMatchObject({ inUniverse: false, universeSize: UNIVERSE_STOCKS.length });
    for (const profile of [own!, outside!]) {
      for (const [key, value] of Object.entries(profile.percentiles)) {
        if (value === null) continue;
        expect(value, `${profile.symbol} ${key}`).toBeGreaterThanOrEqual(0);
        expect(value, `${profile.symbol} ${key}`).toBeLessThanOrEqual(100);
      }
      expect(profile.values.momentum, profile.symbol).toEqual(expect.any(Number));
    }
    expect(await getFactorProfile("ZZZZ")).toBeNull();
  });

  it("build every kind of AI context from the fixture data", { timeout: 30_000 }, async () => {
    const now = new Date(SATURDAY);
    // How a context block says that its source failed or timed out: "Quote: not available.", "Constituents: quotes not
    // available.", "- next report date: not available".
    const MISSING = /: (?:quotes |changes |model signal )?not available/;
    const stock = await buildAnalyzeContext({ kind: "stock", symbol: "AAPL", lang: "en" }, now);
    expect(stock.ok).toBe(true);
    if (!stock.ok) return;
    expect(stock.text).toContain("- next report: 2026-11-16 (");
    expect(stock.text).toContain("Analyst activity (");
    expect(stock.text).toContain("Headlines (");
    expect(stock.text).not.toMatch(MISSING);

    const [first] = await getMarketNews();
    const contexts = await Promise.all([
      buildAnalyzeContext({ kind: "move", symbol: "NVDA", lang: "en" }, now),
      buildAnalyzeContext({ kind: "market", lang: "en" }, now),
      buildAnalyzeContext({ kind: "sector", sector: "technology", lang: "en" }, now),
      buildAnalyzeContext({ kind: "watchlist", symbols: [...DEFAULT_WATCHLIST], positions: [{ symbol: "AAPL", shares: 10, cost: 150 }], lang: "en" }, now),
      buildAnalyzeContext({ kind: "news", newsId: first.id, lang: "en" }, now),
      buildAnalyzeContext({ kind: "stock", symbol: "SPY", lang: "en" }, now),
      buildChatContext({ view: "market", intent: { kind: "compare", symbols: ["AAPL", "MSFT"] } }, now),
      buildChatContext({ view: "stock", symbol: "NVDA", intent: { kind: "earnings", symbol: "NVDA" } }, now),
    ]);
    for (const [i, context] of contexts.entries()) {
      expect(context.ok, `context ${i}`).toBe(true);
      if (!context.ok) continue;
      expect(context.text.length, `context ${i}`).toBeGreaterThan(200);
      expect(context.text, `context ${i}`).not.toMatch(MISSING);
    }
    expect(await buildAnalyzeContext({ kind: "stock", symbol: "ZZZZ", lang: "en" }, now)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("network access", () => {
  // Runs last: every getter above has had its chance to reach the network.
  it("never happened in fixture mode", () => {
    expect(networkCalls).toEqual([]);
  });
});
