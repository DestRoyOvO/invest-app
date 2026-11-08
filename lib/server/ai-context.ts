import "server-only";

import { analystBlock, actionText, earningsBlock, recentActions } from "@/lib/ai-earnings";
import {
  cleanInline,
  clip,
  daysUntil,
  fmtChangePercent,
  fmtCompact,
  fmtDate,
  fmtDaysUntil,
  fmtMultiple,
  fmtNumber,
  fmtPrice,
  fmtRatio,
  fmtShare,
  fmtSigned,
  fmtTime,
  isFiniteNumber,
  NA,
  pairs,
  untrusted,
} from "@/lib/ai-format";
import { fundBlock, mapFundData, type FundData } from "@/lib/ai-fund";
import { dailyVolatility, moveBlock, moveHeader, nearestPeers, newYorkDate, trailingBeta, type MoveInput } from "@/lib/ai-move";
import { assetClassOf, type AssetClass } from "@/lib/ai-notes";
import { dayPnlLine, eventsLine, groupSplitLine, largestGroupSplit, largestMovers, portfolioRisk, portfolioSummary, ranksLine, riskBlock } from "@/lib/ai-portfolio";
import { quantBlock } from "@/lib/ai-quant";
import { valuePortfolio, type ValuedPosition } from "@/lib/portfolio";
import { annualizedVolatility, correlation, dailyReturns, maxDrawdown } from "@/lib/risk";
import { yahooSectorKey } from "@/lib/sectors";
import { normalizeSymbol } from "@/lib/symbols";
import { getSector, MARKET_BOARD, MARKET_STATE_SYMBOL, SECTORS, sectorOfSymbol, UNIVERSE_STOCKS, type BoardSymbol, type SectorDef } from "@/lib/universe";
import type {
  AnalyzeRequest,
  ApiErrorCode,
  ChatRequest,
  FactorProfile,
  KeyStats,
  Lang,
  MarketState,
  NewsItem,
  PositionInput,
  Quote,
  SectorKey,
  SignalReport,
  StockProfile,
} from "@/types/api";
import type { AnalystActivity, EarningsDetail } from "@/types/earnings";

import { fetchArticleText, parseArticleUrl } from "./article";
import { cached, HOUR, peek, put } from "./cache";
import { getAnalystActivity, getEarningsDetail } from "./earnings";
import { alignCloses } from "./history";
import { buildCompanyMatcher, companyScore, findNewsById, getCompanyNews, getMarketNews, getSectorNews, isSpam } from "./news";
import { getFactorProfile } from "./screener";
import { getSignalReport } from "./signal-service";
import { callOptions, getDailyBars, getQuote, getQuotes, getSummary, searchNews, upstream, yf, type DailyBar, type RawNewsItem } from "./yahoo";

// Builds the live context for the AI from server-side data only. Each block is compact and whitelisted (no raw
// JSON), third-party text is wrapped in <untrusted_data> delimiters, and every source is loaded with a time budget
// so that a slow or failing source degrades to "not available" instead of failing the whole request. Relations the
// model tends to get wrong (ranks, contributions, which positions rose or fell, how much of a move the market
// explains) are precomputed by the lib/ai-*.ts modules and written out.

export { cleanInline, fmtChangePercent, fmtCompact, fmtMultiple, fmtNumber, fmtPrice, fmtRatio, untrusted } from "@/lib/ai-format";
export { evaluationLine } from "@/lib/ai-quant";

export interface ContextMeta {
  /** Asset class of a single-symbol context; the stock note picks its sections from it. */
  asset?: AssetClass;
  /** ISO time of the newest regular-session trade behind the data, when known. */
  dataAsOf?: string | null;
  marketState?: MarketState | null;
}

export type ContextResult =
  | ({ ok: true; text: string; subject: Record<Lang, string> } & ContextMeta)
  | { ok: false; status: 404 | 502; code: ApiErrorCode; message: string };

export type ChatContextInput = ChatRequest["context"];

const MAX_CONTEXT_CHARS = 10_000;
/** Time budget for the parallel data loads of one context; slower sources are reported as not available. */
const LOAD_BUDGET_MS = 9_000;
/** The factor profile may have to build the universe snapshot; it never holds up a context for longer than this. */
const FACTOR_BUDGET_MS = 3_000;
/** Article text for the move explainer is fetched within this sub-budget. */
const ARTICLE_BUDGET_MS = 4_000;
const MAX_HEADLINES = 8;
const MAX_WATCHLIST_ROWS = 30;
/** Non-universe watchlist equities whose sector is looked up via the Yahoo profile. */
const MAX_PROFILE_LOOKUPS = 15;
const MAX_SUMMARY_CHARS = 500;
const MAX_RELATED_TICKERS = 5;
/** Same window as the signal engine (lib/server/signal-service.ts), so both share one cached chart request. */
const BARS_LOOKBACK_DAYS = 540;
const TRADING_DAYS = { month1: 21, month3: 63, month6: 126, year: 252 } as const;
/** The portfolio risk block covers the largest positions by value. */
const MAX_RISK_POSITIONS = 25;
const RISK_BENCHMARK = "SPY";
const RISK_WINDOW_DAYS = 366;
/** Company headlines count as news about the move within this window. */
const MOVE_NEWS_HOURS = 48;
const MAX_MOVE_HEADLINES = 8;
const MOVE_ARTICLES = 2;
const MAX_ARTICLE_CHARS = 1_200;
const MOVER_NEWS_COUNT = 8;
const FUND_TTL_MS = 24 * HOUR;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Pure computations
// ---------------------------------------------------------------------------

export interface Technicals {
  /** Usable bars. */
  bars: number;
  lastClose: number | null;
  /** Decimal returns over about 1, 3 and 6 months of sessions. */
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  ma50: number | null;
  ma200: number | null;
  /** Decimal distance of the last close from each moving average. */
  vsMa50: number | null;
  vsMa200: number | null;
}

/** Returns and moving averages from dividend-adjusted closes (the last bar may be the forming session). */
export function computeTechnicals(bars: readonly DailyBar[]): Technicals {
  const closes = bars.map((bar) => bar.adjClose).filter((close) => Number.isFinite(close) && close > 0);
  const count = closes.length;
  const last = count > 0 ? closes[count - 1] : null;
  const change = (sessions: number) => (last !== null && count > sessions ? last / closes[count - 1 - sessions] - 1 : null);
  const average = (length: number) => (count >= length ? closes.slice(-length).reduce((sum, close) => sum + close, 0) / length : null);
  const ma50 = average(50);
  const ma200 = average(200);
  return {
    bars: count,
    lastClose: last,
    return1m: change(TRADING_DAYS.month1),
    return3m: change(TRADING_DAYS.month3),
    return6m: change(TRADING_DAYS.month6),
    ma50,
    ma200,
    vsMa50: last !== null && ma50 ? last / ma50 - 1 : null,
    vsMa200: last !== null && ma200 ? last / ma200 - 1 : null,
  };
}

/** Market-cap-weighted average change (percent units); a plain average when no caps are known. */
export function capWeightedChange(quotes: readonly Quote[]): number | null {
  const withChange = quotes.filter((quote) => isFiniteNumber(quote.changePercent));
  const weighted = withChange.filter((quote) => isFiniteNumber(quote.marketCap) && (quote.marketCap ?? 0) > 0);
  if (weighted.length > 0) {
    const totalCap = weighted.reduce((sum, quote) => sum + (quote.marketCap ?? 0), 0);
    return weighted.reduce((sum, quote) => sum + (quote.marketCap ?? 0) * (quote.changePercent ?? 0), 0) / totalCap;
  }
  if (withChange.length === 0) return null;
  return withChange.reduce((sum, quote) => sum + (quote.changePercent ?? 0), 0) / withChange.length;
}

export interface ConcentrationGroup {
  group: string;
  count: number;
  /** Share of holdings by count (0..1). */
  countShare: number;
  /** Share of the known market cap (0..1); null when no holding has a market cap. */
  capShare: number | null;
}

export interface Concentration {
  holdings: number;
  /** Holdings with a known market cap. */
  withCap: number;
  groups: ConcentrationGroup[];
  largestByCount: ConcentrationGroup | null;
  largestByCap: ConcentrationGroup | null;
}

export function computeConcentration(rows: ReadonlyArray<{ group: string; marketCap: number | null }>): Concentration {
  const byGroup = new Map<string, { count: number; cap: number }>();
  let totalCap = 0;
  let withCap = 0;
  for (const row of rows) {
    const entry = byGroup.get(row.group) ?? { count: 0, cap: 0 };
    entry.count += 1;
    if (isFiniteNumber(row.marketCap) && row.marketCap > 0) {
      entry.cap += row.marketCap;
      totalCap += row.marketCap;
      withCap += 1;
    }
    byGroup.set(row.group, entry);
  }
  const groups: ConcentrationGroup[] = [...byGroup.entries()]
    .map(([group, entry]) => ({
      group,
      count: entry.count,
      countShare: rows.length > 0 ? entry.count / rows.length : 0,
      capShare: totalCap > 0 ? entry.cap / totalCap : null,
    }))
    .sort((a, b) => b.count - a.count || (b.capShare ?? 0) - (a.capShare ?? 0));
  const largestByCap = totalCap > 0 ? [...groups].sort((a, b) => (b.capShare ?? 0) - (a.capShare ?? 0))[0] : null;
  return { holdings: rows.length, withCap, groups, largestByCount: groups[0] ?? null, largestByCap };
}

interface Section {
  name: string;
  text: string | null;
}

/** Joins sections in priority order, skipping whole sections that would exceed the budget (never cutting one). */
export function joinSections(sections: readonly Section[], maxChars: number = MAX_CONTEXT_CHARS): string {
  const kept: string[] = [];
  const omitted: string[] = [];
  let length = 0;
  for (const section of sections) {
    const text = section.text?.trim();
    if (!text) continue;
    const added = text.length + (kept.length > 0 ? 2 : 0);
    if (length + added > maxChars) {
      omitted.push(section.name);
      continue;
    }
    kept.push(text);
    length += added;
  }
  if (omitted.length > 0) kept.push(`(Omitted for length: ${omitted.join(", ")}.)`);
  return kept.join("\n\n");
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** The newest regular-session trade time among quotes (ISO), and the market state of that quote. */
export function newestTrade(quotes: Iterable<Quote | undefined>): { dataAsOf: string | null; marketState: MarketState | null } {
  let best: Quote | undefined;
  for (const quote of quotes) {
    if (!quote?.regularMarketTime) continue;
    if (!best?.regularMarketTime || quote.regularMarketTime > best.regularMarketTime) best = quote;
  }
  return { dataAsOf: best?.regularMarketTime ?? null, marketState: best?.marketState ?? null };
}

// ---------------------------------------------------------------------------
// Loading with a time budget
// ---------------------------------------------------------------------------

type Settled<T> = { ok: true; value: T } | { ok: false; reason: "error" | "timeout" };

interface Budget {
  expired: Promise<void>;
  clear(): void;
}

function startBudget(ms: number): Budget {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { expired, clear: () => clearTimeout(timer) };
}

function settle<T>(promise: Promise<T>, budget: Budget): Promise<Settled<T>> {
  return Promise.race([
    promise.then(
      (value): Settled<T> => ({ ok: true, value }),
      (): Settled<T> => ({ ok: false, reason: "error" }),
    ),
    budget.expired.then((): Settled<T> => ({ ok: false, reason: "timeout" })),
  ]);
}

/** Starts a load immediately; synchronous throws become rejections. */
function attempt<T>(load: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(load());
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Resolves with the load's value, or null once `ms` pass (the load itself keeps running and fills its cache). */
function within<T>(load: Promise<T>, ms: number): Promise<T | null> {
  const budget = startBudget(ms);
  return settle(load, budget).then((settled) => {
    budget.clear();
    return settled.ok ? settled.value : null;
  });
}

function valueOf<T>(settled: Settled<T>): T | null {
  return settled.ok ? (settled.value ?? null) : null;
}

const UPSTREAM_FAILURE: ContextResult = {
  ok: false,
  status: 502,
  code: "upstream_error",
  message: "Market data provider is unavailable. Please retry shortly.",
};

// ---------------------------------------------------------------------------
// Shared blocks
// ---------------------------------------------------------------------------

function headlineBlock(items: readonly NewsItem[] | null, label = "Headlines"): string {
  if (items === null) return `${label}: not available.`;
  if (items.length === 0) return `${label}: none found.`;
  const lines = items.slice(0, MAX_HEADLINES).map((item) => {
    const related = item.relatedTickers.map(normalizeSymbol).filter((symbol): symbol is string => symbol !== null).slice(0, 4);
    const tickers = related.length > 0 ? ` [${related.join(", ")}]` : "";
    const publisher = cleanInline(item.publisher, 40) || "unknown publisher";
    return `- ${fmtTime(item.publishedAt)} | ${publisher} | ${item.provenance}${tickers}: ${cleanInline(item.title, 200)}`;
  });
  return `${label} (third-party text, most relevant first; date | publisher | provenance [tickers]: title):\n${untrusted(lines.join("\n"))}`;
}

function compactQuoteLine(quote: Quote): string {
  const valuation = pairs([
    ["cap", fmtCompact(quote.marketCap, quote.currency)],
    ["P/E", fmtMultiple(quote.trailingPE)],
    ["fwd P/E", fmtMultiple(quote.forwardPE)],
  ]);
  return `- ${quote.symbol} ${cleanInline(quote.name, 40)}: ${fmtPrice(quote.price)} (${fmtChangePercent(quote.changePercent)})${valuation ? `, ${valuation}` : ""}`;
}

function boardLine(item: BoardSymbol, quote: Quote | undefined): string {
  const label = `${item.label.en} (${item.code})`;
  if (!quote) return `- ${label}: not available`;
  if (item.kind === "yield") {
    const change = isFiniteNumber(quote.change) ? `${quote.change > 0 ? "+" : ""}${quote.change.toFixed(3)} pt` : NA;
    return `- ${label}: ${fmtNumber(quote.price, 3)}% (change ${change})`;
  }
  return `- ${label}: ${fmtPrice(quote.price)} (${fmtChangePercent(quote.changePercent)})`;
}

function shareCount(value: number): string {
  return fmtNumber(value, Number.isInteger(value) ? 0 : 4);
}

/** The investor's position in the symbol on the stock page, valued at the latest price (lib/portfolio.ts). */
export function positionLine(position: PositionInput, quote: Quote | null): string {
  const base = `Your position (entered by the investor): ${shareCount(position.shares)} sh at ${fmtPrice(position.cost)} average cost`;
  const { rows, foreign } = valuePortfolio([position], () => quote ?? undefined);
  const row: ValuedPosition | undefined = rows[0] ?? foreign[0];
  if (!row) return `${base}; no current price, so it is not valued.`;
  const day = row.dayPnl !== null ? `, today ${fmtSigned(row.dayPnl)}` : "";
  return `${base}; value ${fmtNumber(row.value)} ${row.currency}, unrealized ${fmtSigned(row.pnl)} (${fmtRatio(row.pnlPct, 1, true)})${day}.`;
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

function stockHeader(symbol: string, quote: Quote | null, profile: StockProfile | null): string {
  const name = cleanInline(profile?.longName ?? profile?.name ?? quote?.name ?? symbol);
  const details = pairs([
    ["type", cleanInline(quote?.quoteType) || NA],
    ["sector", cleanInline(profile?.sector) || NA],
    ["industry", cleanInline(profile?.industry) || NA],
    ["exchange", cleanInline(quote?.exchange ?? profile?.exchange) || NA],
    ["currency", cleanInline(quote?.currency ?? profile?.currency) || NA],
    ["country", cleanInline(profile?.country) || NA],
    ["employees", isFiniteNumber(profile?.employees) ? fmtNumber(profile?.employees, 0) : NA],
  ]);
  return `Stock: ${symbol} (${name})${details ? `; ${details}` : ""}.`;
}

function quoteBlock(quote: Quote | null, stats: KeyStats | null): string {
  if (!quote) return "Quote: not available.";
  const stale = quote.stale ? `; this quote is older data from ${fmtTime(quote.fetchedAt)} because the latest refresh failed` : "";
  const lines = [
    `Quote (market state ${quote.marketState ?? NA}, last regular-session trade ${fmtTime(quote.regularMarketTime)}${stale}):`,
    `- ${pairs([
      ["price", fmtPrice(quote.price)],
      ["change", isFiniteNumber(quote.change) ? `${quote.change > 0 ? "+" : ""}${fmtPrice(quote.change)} (${fmtChangePercent(quote.changePercent)})` : NA],
      ["previous close", fmtPrice(quote.previousClose)],
    ])}`,
  ];
  const day = pairs([
    ["open", fmtPrice(quote.open)],
    ["day range", isFiniteNumber(quote.dayLow) && isFiniteNumber(quote.dayHigh) ? `${fmtPrice(quote.dayLow)}-${fmtPrice(quote.dayHigh)}` : NA],
  ]);
  if (day) lines.push(`- ${day}`);
  if (isFiniteNumber(quote.volume)) {
    const relative = isFiniteNumber(quote.avgVolume) && quote.avgVolume > 0 ? ` (${(quote.volume / quote.avgVolume).toFixed(2)}x)` : "";
    lines.push(`- volume ${fmtCompact(quote.volume)} vs 3-month average ${fmtCompact(quote.avgVolume)}${relative}`);
  }
  if (quote.extendedSession && isFiniteNumber(quote.extendedPrice)) {
    const session = quote.extendedSession === "PRE" ? "pre-market" : "after-hours";
    lines.push(`- ${session} ${fmtPrice(quote.extendedPrice)} (${fmtChangePercent(quote.extendedChangePercent)})`);
  }
  const high = quote.fiftyTwoWeekHigh ?? stats?.fiftyTwoWeekHigh ?? null;
  const low = quote.fiftyTwoWeekLow ?? stats?.fiftyTwoWeekLow ?? null;
  if (isFiniteNumber(high) && isFiniteNumber(low) && isFiniteNumber(quote.price) && high > 0 && low > 0) {
    // The stored range can lag a new intraday extreme, so a price outside it is described instead of given a sign flip.
    const fromHigh = quote.price >= high ? "at or above the 52-week high" : `${fmtRatio(1 - quote.price / high)} below the high`;
    const fromLow = quote.price <= low ? "at or below the 52-week low" : `${fmtRatio(quote.price / low - 1)} above the low`;
    lines.push(`- 52-week range ${fmtPrice(low)}-${fmtPrice(high)}: ${fromHigh}, ${fromLow}`);
  }
  const cap = fmtCompact(quote.marketCap ?? stats?.marketCap, quote.currency);
  if (cap !== NA) lines.push(`- market cap ${cap}`);
  return lines.join("\n");
}

function earningsLine(nextEarningsDate: string | null, now: Date): string | null {
  if (!nextEarningsDate) return null;
  const upcoming = nextEarningsDate.slice(0, 10) >= now.toISOString().slice(0, 10);
  return `- Next earnings date: ${fmtDate(nextEarningsDate)} (${upcoming ? "upcoming" : "most recent report; no future date announced"})`;
}

interface StatsOptions {
  /** The Analyst activity block is present, so the analyst line is left out here. */
  skipAnalysts?: boolean;
  /** The Earnings block is present, so the earnings date is left out here. */
  skipEarnings?: boolean;
}

function statsBlock(stats: KeyStats | null, price: number | null, currency: string | null, now: Date, options: StatsOptions = {}): string {
  if (!stats) return "Key statistics: not available.";
  const lines: string[] = [];
  const add = (label: string, body: string) => {
    if (body) lines.push(`- ${label}: ${body}`);
  };
  add(
    "Valuation",
    pairs([
      ["P/E (ttm)", fmtMultiple(stats.trailingPE)],
      ["forward P/E", fmtMultiple(stats.forwardPE)],
      ["PEG", fmtNumber(stats.pegRatio)],
      ["price/book", fmtMultiple(stats.priceToBook)],
      ["EPS (ttm)", fmtNumber(stats.eps)],
      ["forward EPS", fmtNumber(stats.forwardEps)],
      ["dividend yield", fmtRatio(stats.dividendYield, 2)],
      ["beta (Yahoo)", fmtNumber(stats.beta)],
    ]),
  );
  add(
    "Quality",
    pairs([
      ["ROE", fmtRatio(stats.roe)],
      ["gross margin", fmtRatio(stats.grossMargin)],
      ["operating margin", fmtRatio(stats.operatingMargin)],
      ["net margin", fmtRatio(stats.profitMargin)],
      ["free cash flow", fmtCompact(stats.freeCashflow, currency)],
    ]),
  );
  add(
    "Growth (latest quarter, year over year)",
    pairs([
      ["revenue", fmtRatio(stats.revenueGrowth, 1, true)],
      ["earnings", fmtRatio(stats.earningsGrowth, 1, true)],
    ]),
  );
  add(
    "Balance sheet",
    pairs([
      ["cash", fmtCompact(stats.totalCash, currency)],
      ["debt", fmtCompact(stats.totalDebt, currency)],
      ["debt/equity", fmtNumber(stats.debtToEquity)],
      ["revenue (ttm)", fmtCompact(stats.totalRevenue, currency)],
    ]),
  );
  if (isFiniteNumber(stats.targetMeanPrice) && !options.skipAnalysts) {
    const implied = isFiniteNumber(price) && price > 0 ? ` (${fmtRatio(stats.targetMeanPrice / price - 1, 1, true)} vs the price)` : "";
    const range =
      isFiniteNumber(stats.targetLowPrice) && isFiniteNumber(stats.targetHighPrice)
        ? `, range ${fmtPrice(stats.targetLowPrice)}-${fmtPrice(stats.targetHighPrice)}`
        : "";
    const consensus = stats.recommendationKey ? `, consensus ${cleanInline(stats.recommendationKey, 20).replace(/_/g, " ")}` : "";
    const mean = isFiniteNumber(stats.recommendationMean) ? ` (mean rating ${stats.recommendationMean.toFixed(1)} on 1 = strong buy ... 5 = sell)` : "";
    const analysts = isFiniteNumber(stats.numberOfAnalysts) ? `, ${stats.numberOfAnalysts} analysts` : "";
    lines.push(`- Analysts (opinions): mean target ${fmtPrice(stats.targetMeanPrice)}${implied}${range}${consensus}${mean}${analysts}`);
  } else if (isFiniteNumber(stats.targetMeanPrice) && isFiniteNumber(price) && price > 0) {
    lines.push(`- Mean analyst target ${fmtPrice(stats.targetMeanPrice)} is ${fmtRatio(stats.targetMeanPrice / price - 1, 1, true)} from the price (an opinion)`);
  }
  const earnings = options.skipEarnings ? null : earningsLine(stats.nextEarningsDate, now);
  if (earnings) lines.push(earnings);
  if (stats.exDividendDate) lines.push(`- Ex-dividend date: ${fmtDate(stats.exDividendDate)}`);
  return lines.length > 0 ? `Key statistics:\n${lines.join("\n")}` : "Key statistics: not available.";
}

function technicalsBlock(bars: readonly DailyBar[] | null): string {
  if (!bars) return "Technicals: not available.";
  const t = computeTechnicals(bars);
  if (t.bars < TRADING_DAYS.month1 + 1) return "Technicals: not enough price history.";
  const lines = [
    `Technicals (${t.bars} daily dividend-adjusted closes):`,
    `- returns: ${pairs([
      ["1 month", fmtRatio(t.return1m, 1, true)],
      ["3 months", fmtRatio(t.return3m, 1, true)],
      ["6 months", fmtRatio(t.return6m, 1, true)],
    ])}`,
  ];
  const averages = pairs([
    ["vs 50-day average", t.ma50 !== null ? `${fmtRatio(t.vsMa50, 1, true)} (MA50 ${fmtPrice(t.ma50)})` : NA],
    ["vs 200-day average", t.ma200 !== null ? `${fmtRatio(t.vsMa200, 1, true)} (MA200 ${fmtPrice(t.ma200)})` : NA],
  ]);
  if (averages) lines.push(`- price ${averages}`);
  if (t.ma50 !== null && t.ma200 !== null) lines.push(`- MA50 is ${t.ma50 >= t.ma200 ? "above" : "below"} MA200`);
  return lines.join("\n");
}

function profileBlock(profile: StockProfile | null): string {
  const summary = profile?.summary?.trim();
  if (!summary) return "";
  const clipped = summary.length > MAX_SUMMARY_CHARS ? `${summary.slice(0, MAX_SUMMARY_CHARS - 1)}…` : summary;
  return `Business description (third-party text):\n${untrusted(clipped)}`;
}

/** Fund holdings and profile from one quoteSummary call (cached 24 hours). Null for symbols without fund data. */
export async function getFundData(symbol: string): Promise<FundData | null> {
  return cached(`ai-fund:${symbol}`, { ttlMs: FUND_TTL_MS, staleMs: 2 * FUND_TTL_MS }, async () => {
    try {
      const raw = await upstream(() => yf.quoteSummary(symbol, { modules: ["topHoldings", "fundProfile"] }, callOptions()));
      return mapFundData(raw as unknown as Record<string, unknown>);
    } catch (error) {
      if (/not found|No fundamentals|Not Found|404/i.test(String(error))) return null;
      throw error;
    }
  });
}

interface StockOptions {
  /** The investor's position in this symbol (chat on the stock page). */
  position?: PositionInput;
}

async function stockContext(symbol: string, now: Date, options: StockOptions = {}): Promise<ContextResult> {
  const budget = startBudget(LOAD_BUDGET_MS);
  try {
    const quotePromise = attempt(() => getQuote(symbol));
    const summaryPromise = attempt(() => getSummary(symbol));
    // News needs the company name and profile, so it starts as soon as the quote and summary are in.
    const newsPromise = Promise.allSettled([quotePromise, summaryPromise]).then(([quote, summary]) => {
      const profile = summary.status === "fulfilled" ? (summary.value?.profile ?? null) : null;
      const quoteName = quote.status === "fulfilled" ? quote.value?.name : undefined;
      return getCompanyNews(symbol, profile?.longName ?? profile?.name ?? quoteName ?? symbol, profile);
    });
    // Earnings, analysts and style factors are for companies, the holdings block for funds: the quote type decides.
    const assetPromise = quotePromise.then(
      (quote) => assetClassOf(quote?.quoteType),
      (): AssetClass => "equity",
    );
    const forAsset = <T,>(asset: AssetClass, load: () => Promise<T>) => assetPromise.then((current) => (current === asset ? load() : null));
    const [quoteR, summaryR, barsR, signalR, newsR, earningsR, analystsR, factorsR, fundR] = await Promise.all([
      settle(quotePromise, budget),
      settle(summaryPromise, budget),
      settle(attempt(() => getDailyBars(symbol, BARS_LOOKBACK_DAYS)), budget),
      settle(attempt(() => getSignalReport(symbol)), budget),
      settle(newsPromise, budget),
      settle<EarningsDetail | null>(forAsset("equity", () => getEarningsDetail(symbol)), budget),
      settle<AnalystActivity | null>(forAsset("equity", () => getAnalystActivity(symbol)), budget),
      settle<FactorProfile | null>(forAsset("equity", () => within(attempt(() => getFactorProfile(symbol)), FACTOR_BUDGET_MS)), budget),
      settle<FundData | null>(forAsset("fund", () => getFundData(symbol)), budget),
    ]);

    const quote = valueOf(quoteR);
    const summary = valueOf(summaryR);
    if (!quote && !summary) {
      // Both sources answered and neither knows the symbol: unknown ticker. Otherwise the provider failed.
      if (quoteR.ok && summaryR.ok) return { ok: false, status: 404, code: "not_found", message: `No market data found for ${symbol}.` };
      return UPSTREAM_FAILURE;
    }
    const profile = summary?.profile ?? null;
    const stats = summary?.stats ?? null;
    const name = cleanInline(profile?.longName ?? profile?.name ?? quote?.name ?? symbol);
    const currency = quote?.currency ?? profile?.currency ?? null;
    const asset = assetClassOf(quote?.quoteType);
    const bars = valueOf(barsR);
    const earnings = asset === "equity" ? earningsBlock({ detail: valueOf(earningsR), bars, currency, quoteNextDate: quote?.nextEarningsDate, quoteDateEstimated: quote?.earningsDateEstimated, now }) : null;
    const analysts = asset === "equity" ? analystBlock(valueOf(analystsR), now) : null;

    const text = joinSections([
      { name: "header", text: stockHeader(symbol, quote, profile) },
      { name: "quote", text: quoteBlock(quote, stats) },
      { name: "position", text: options.position ? positionLine(options.position, quote) : null },
      { name: "earnings", text: earnings },
      { name: "analyst activity", text: analysts },
      { name: "key statistics", text: statsBlock(stats, quote?.price ?? null, currency, now, { skipAnalysts: analysts !== null, skipEarnings: earnings !== null }) },
      { name: "fund profile", text: asset === "fund" ? fundBlock(valueOf(fundR), quote) : null },
      { name: "technicals", text: technicalsBlock(bars) },
      { name: "quant facts", text: quantBlock({ report: valueOf(signalR), profile: valueOf(factorsR), asset }) },
      { name: "headlines", text: headlineBlock(valueOf(newsR)) },
      { name: "business description", text: profileBlock(profile) },
    ]);
    return {
      ok: true,
      text,
      subject: { en: `${symbol} (${name})`, zh: `${symbol}（${name}）` },
      asset,
      dataAsOf: quote?.regularMarketTime ?? null,
      marketState: quote?.marketState ?? null,
    };
  } finally {
    budget.clear();
  }
}

// ---------------------------------------------------------------------------
// Move explainer
// ---------------------------------------------------------------------------

/** The universe sector of a symbol, or the one its Yahoo sector maps onto. */
function sectorFor(symbol: string, yahooSector: string | null): SectorDef | undefined {
  const universe = sectorOfSymbol(symbol);
  if (universe) return universe;
  const key = yahooSectorKey(yahooSector);
  return key ? getSector(key) : undefined;
}

/** Company headlines published within the last `hours` hours, in the news ranking's order (most relevant first). */
export function recentCompanyNews(items: readonly NewsItem[] | null, now: Date, hours = MOVE_NEWS_HOURS): NewsItem[] {
  if (!items) return [];
  const since = now.getTime() - hours * 3_600_000;
  return items
    .filter((item) => item.provenance === "company")
    .filter((item) => {
      const t = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN;
      return Number.isFinite(t) && t >= since && t <= now.getTime() + 3_600_000;
    })
    .slice(0, MAX_MOVE_HEADLINES);
}

/** The last trade of a finished session (epoch ms); NaN while the session trades or when unknown. */
function sessionClose(quote: Quote | null): number {
  return quote && quote.marketState !== "REGULAR" && quote.regularMarketTime ? Date.parse(quote.regularMarketTime) : Number.NaN;
}

function publishedAfter(item: { publishedAt: string | null }, close: number): boolean {
  return Number.isFinite(close) && item.publishedAt !== null && Date.parse(item.publishedAt) > close;
}

/** Stories that could explain the session first (published before its close), each group in relevance order. */
export function orderForMove(items: readonly NewsItem[], quote: Quote | null): NewsItem[] {
  const close = sessionClose(quote);
  return [...items.filter((item) => !publishedAfter(item, close)), ...items.filter((item) => publishedAfter(item, close))];
}

/**
 * The numbered headlines. Outside the session, stories published after its last trade are marked: they cannot explain
 * the session's move (only an extended-hours one).
 */
function numberedHeadlines(items: readonly NewsItem[], quote: Quote): string {
  if (items.length === 0) return `Company headlines from the last ${MOVE_NEWS_HOURS} hours: none found.`;
  const close = sessionClose(quote);
  const lines = items.map((item, i) => {
    const publisher = cleanInline(item.publisher, 40) || "unknown publisher";
    const after = publishedAfter(item, close) ? " (after the close)" : "";
    return `[${i + 1}] ${fmtTime(item.publishedAt)}${after} | ${publisher}: ${cleanInline(item.title, 200)}`;
  });
  return `Company headlines from the last ${MOVE_NEWS_HOURS} hours (third-party text, most relevant first; "after the close" marks stories published after the session's last trade, which cannot explain the session's move; cite them as [n]):\n${untrusted(lines.join("\n"))}`;
}

/**
 * Article text, cached for an hour so that re-analyzing a headline does not fetch the page again. Failures are not
 * cached: a timeout or an unreadable page is retried on the next request.
 */
async function loadArticle(link: string, signal?: AbortSignal): Promise<string | null> {
  const key = `article:${link}`;
  const hit = peek<string>(key);
  if (hit !== undefined) return hit;
  const text = await (signal ? fetchArticleText(link, { signal }) : fetchArticleText(link));
  if (text !== null) put(key, text, { ttlMs: HOUR });
  return text;
}

/** Text of the first `count` headlines, each clipped, fetched together within the article sub-budget. */
async function loadMoveArticles(items: readonly NewsItem[]): Promise<Array<string | null>> {
  const picked = items.slice(0, MOVE_ARTICLES);
  if (picked.length === 0) return [];
  const controller = new AbortController();
  const budget = startBudget(ARTICLE_BUDGET_MS);
  try {
    const settled = await Promise.all(picked.map((item) => settle(attempt(() => loadArticle(item.link, controller.signal)), budget)));
    return settled.map((result) => {
      const text = valueOf(result);
      return text ? clip(text, MAX_ARTICLE_CHARS) : null;
    });
  } finally {
    budget.clear();
    controller.abort();
  }
}

/**
 * Earnings, ex-dividend and analyst events around the move. Analyst activity that did not load (or does not exist, for
 * funds and other non-equities) is never reported as "no actions": that would invent a fact the attribution relies on.
 */
function eventsForMove(quote: Quote, analysts: AnalystActivity | null, asset: AssetClass, now: Date): string {
  const parts: string[] = [];
  if (quote.lastEarningsDate) {
    const days = daysUntil(quote.lastEarningsDate, now);
    if (days !== null && days <= 0 && days >= -4) parts.push(`last earnings report ${quote.lastEarningsDate.slice(0, 10)} (${fmtDaysUntil(days)})`);
  }
  if (quote.nextEarningsDate) {
    const days = daysUntil(quote.nextEarningsDate, now);
    if (days !== null && days >= 0) parts.push(`next earnings report ${quote.nextEarningsDate.slice(0, 10)} (${quote.earningsDateEstimated ? "estimated" : "confirmed"}, ${fmtDaysUntil(days)})`);
  }
  if (quote.exDividendDate) {
    const days = daysUntil(quote.exDividendDate, now);
    if (days !== null && days >= -2 && days <= 2) parts.push(`ex-dividend ${quote.exDividendDate.slice(0, 10)}`);
  }
  if (analysts) {
    const actions = recentActions(analysts, now, 5);
    parts.push(actions.length > 0 ? `analyst actions in the last 5 days: ${actions.slice(0, 4).map(actionText).join("; ")}` : "no analyst rating or target actions in the last 5 days");
  } else if (asset === "equity") {
    parts.push("analyst actions: not available");
  }
  const label = asset === "equity" ? "Scheduled events and analyst actions around the move" : "Scheduled events around the move";
  return `${label}: ${parts.length > 0 ? parts.join("; ") : "none known"}.`;
}

async function moveContext(symbol: string, now: Date, options: StockOptions = {}): Promise<ContextResult> {
  const budget = startBudget(LOAD_BUDGET_MS);
  try {
    const quotePromise = attempt(() => getQuote(symbol));
    const summaryPromise = attempt(() => getSummary(symbol));
    const profileOf = (summary: PromiseSettledResult<Awaited<ReturnType<typeof getSummary>>>) => (summary.status === "fulfilled" ? (summary.value?.profile ?? null) : null);
    const sectorPromise = Promise.allSettled([summaryPromise]).then(([summary]) => sectorFor(symbol, profileOf(summary)?.sector ?? null));
    const peersPromise = sectorPromise.then((sector) =>
      getQuotes(unique([MARKET_STATE_SYMBOL, ...(sector ? [sector.etf, ...sector.relatedEtfs, ...sector.stocks] : [])]).filter((s) => s !== symbol)),
    );
    const newsPromise = Promise.allSettled([quotePromise, summaryPromise]).then(([quote, summary]) => {
      const profile = profileOf(summary);
      const quoteName = quote.status === "fulfilled" ? quote.value?.name : undefined;
      return getCompanyNews(symbol, profile?.longName ?? profile?.name ?? quoteName ?? symbol, profile);
    });
    const articlesPromise = Promise.all([newsPromise, quotePromise.catch(() => null)]).then(([news, quote]) => loadMoveArticles(orderForMove(recentCompanyNews(news, now), quote)));
    const analystsPromise = quotePromise.then((quote) => (assetClassOf(quote?.quoteType) === "equity" ? getAnalystActivity(symbol) : null));

    const [quoteR, summaryR, barsR, benchmarkR, signalR, peersR, newsR, articlesR, analystsR, sectorR] = await Promise.all([
      settle(quotePromise, budget),
      settle(summaryPromise, budget),
      settle(attempt(() => getDailyBars(symbol, BARS_LOOKBACK_DAYS)), budget),
      settle(attempt(() => getDailyBars(RISK_BENCHMARK, BARS_LOOKBACK_DAYS)), budget),
      settle(attempt(() => getSignalReport(symbol)), budget),
      settle(peersPromise, budget),
      settle(newsPromise, budget),
      settle(articlesPromise, budget),
      settle(analystsPromise, budget),
      settle(sectorPromise, budget),
    ]);

    const quote = valueOf(quoteR);
    if (!quote) {
      // Yahoo answered without a quote: an unknown symbol. A failed request is an outage.
      if (quoteR.ok) return { ok: false, status: 404, code: "not_found", message: `No market data found for ${symbol}.` };
      return UPSTREAM_FAILURE;
    }
    const profile = valueOf(summaryR)?.profile ?? null;
    const name = cleanInline(profile?.longName ?? profile?.name ?? quote.name ?? symbol);
    const sector = valueOf(sectorR) ?? undefined;
    const quotes = valueOf(peersR) ?? new Map<string, Quote>();
    const bars = valueOf(barsR);
    const report: SignalReport | null = valueOf(signalR);
    const reportBeta = report?.risk?.beta;
    const benchmarkBars = valueOf(benchmarkR);
    let beta: MoveInput["beta"] = null;
    if (isFiniteNumber(reportBeta)) beta = { value: reportBeta, source: "risk report" };
    else if (Array.isArray(bars) && Array.isArray(benchmarkBars)) {
      const fallback = trailingBeta(bars, benchmarkBars);
      if (fallback !== null) beta = { value: fallback, source: "daily bars" };
    }
    const sectorStocks = sector ? sector.stocks.map((s) => quotes.get(s)).filter((q): q is Quote => q !== undefined) : [];
    const input: MoveInput = {
      quote,
      market: quotes.get(MARKET_STATE_SYMBOL),
      sectorLabel: sector?.label.en ?? null,
      sectorEtf: sector ? quotes.get(sector.etf) : undefined,
      relatedEtfs: sector ? sector.relatedEtfs.filter((etf) => etf !== sector.etf).map((etf) => quotes.get(etf)).filter((q): q is Quote => q !== undefined) : [],
      peers: nearestPeers(symbol, quote.marketCap, sectorStocks),
      beta,
      dailyVolatility: Array.isArray(bars) ? dailyVolatility(bars, newYorkDate(quote.regularMarketTime)) : null,
      session: sessionLabel(quote),
    };

    const headlines = orderForMove(recentCompanyNews(valueOf(newsR), now), quote);
    const articles = valueOf(articlesR) ?? [];
    const articleSections: Section[] = articles.flatMap((text, i) =>
      text ? [{ name: `article ${i + 1}`, text: `Article text for [${i + 1}] (third-party, clipped):\n${untrusted(text)}` }] : [],
    );

    const text = joinSections([
      { name: "header", text: moveHeader(symbol, name, profile?.industry ?? null) },
      { name: "position", text: options.position ? positionLine(options.position, quote) : null },
      { name: "move", text: moveBlock(input) },
      { name: "headlines", text: newsR.ok ? numberedHeadlines(headlines, quote) : "Company headlines: not available." },
      ...articleSections,
      { name: "events", text: eventsForMove(quote, valueOf(analystsR), assetClassOf(quote.quoteType), now) },
    ]);
    return {
      ok: true,
      text,
      subject: { en: `the latest move in ${symbol} (${name})`, zh: `${symbol}（${name}）的最新涨跌` },
      asset: assetClassOf(quote.quoteType),
      dataAsOf: quote.regularMarketTime,
      marketState: quote.marketState,
    };
  } finally {
    budget.clear();
  }
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

/** Last-year return, volatility, beta and drawdown of one symbol from its daily bars. */
function yearStats(bars: readonly DailyBar[] | null, benchmark: readonly DailyBar[] | null) {
  if (!bars || bars.length < TRADING_DAYS.month1 + 1) return null;
  const closes = bars.map((bar) => bar.adjClose).filter((close) => Number.isFinite(close) && close > 0);
  const year = closes.slice(-(TRADING_DAYS.year + 1));
  return {
    technicals: computeTechnicals(bars),
    return1y: closes.length > TRADING_DAYS.year ? closes[closes.length - 1] / closes[closes.length - 1 - TRADING_DAYS.year] - 1 : null,
    volatility: annualizedVolatility(dailyReturns(year)),
    beta: benchmark ? trailingBeta(bars, benchmark) : null,
    drawdown: maxDrawdown(year)?.depth ?? null,
  };
}

async function compareContext(symbols: readonly string[], now: Date): Promise<ContextResult> {
  const budget = startBudget(LOAD_BUDGET_MS);
  try {
    const [quotesR, benchmarkR, ...barsR] = await Promise.all([
      settle(attempt(() => getQuotes([...symbols])), budget),
      settle(attempt(() => getDailyBars(RISK_BENCHMARK, BARS_LOOKBACK_DAYS)), budget),
      ...symbols.map((symbol) => settle(attempt(() => getDailyBars(symbol, BARS_LOOKBACK_DAYS)), budget)),
    ]);
    if (!quotesR.ok) return UPSTREAM_FAILURE;
    const quotes = quotesR.value;
    const known = symbols.filter((symbol) => quotes.has(symbol));
    if (known.length === 0) return { ok: false, status: 404, code: "not_found", message: "None of the symbols to compare were found." };
    const benchmark = valueOf(benchmarkR);
    const barsBySymbol = new Map<string, DailyBar[]>();
    symbols.forEach((symbol, i) => {
      const bars = valueOf(barsR[i]);
      if (Array.isArray(bars)) barsBySymbol.set(symbol, bars);
    });

    const lines = known.map((symbol) => {
      const quote = quotes.get(symbol) as Quote;
      const stats = yearStats(barsBySymbol.get(symbol) ?? null, Array.isArray(benchmark) ? benchmark : null);
      const valuation = pairs([
        ["cap", fmtCompact(quote.marketCap, quote.currency)],
        ["P/E", fmtMultiple(quote.trailingPE)],
        ["fwd P/E", fmtMultiple(quote.forwardPE)],
        ["P/B", fmtMultiple(quote.priceToBook)],
        ["dividend yield", fmtRatio(quote.dividendYield, 2)],
      ]);
      const returns = stats
        ? pairs([
            ["1M", fmtRatio(stats.technicals.return1m, 1, true)],
            ["3M", fmtRatio(stats.technicals.return3m, 1, true)],
            ["6M", fmtRatio(stats.technicals.return6m, 1, true)],
            ["1Y", fmtRatio(stats.return1y, 1, true)],
          ])
        : "";
      const risk = stats
        ? pairs([
            ["1-year volatility", fmtRatio(stats.volatility)],
            ["beta to SPY", fmtNumber(stats.beta)],
            ["1-year max drawdown", fmtRatio(stats.drawdown, 1, true)],
          ])
        : "";
      return `- ${symbol} ${cleanInline(quote.name, 40)} (${cleanInline(quote.quoteType) || "type n/a"}): ${fmtPrice(quote.price)} (${fmtChangePercent(quote.changePercent)})${valuation ? `; ${valuation}` : ""}${returns ? `; returns ${returns}` : ""}${risk ? `; ${risk}` : ""}`;
    });

    const aligned = alignCloses(known, barsBySymbol, now.getTime() - RISK_WINDOW_DAYS * DAY_MS);
    const correlations: string[] = [];
    for (let i = 0; i < known.length; i++) {
      for (let j = i + 1; j < known.length; j++) {
        const a = aligned.closes[known[i]];
        const b = aligned.closes[known[j]];
        const r = a && b ? correlation(dailyReturns(a), dailyReturns(b)) : null;
        if (r !== null) correlations.push(`${known[i]}/${known[j]} ${fmtNumber(r)}`);
      }
    }
    const missing = symbols.filter((symbol) => !quotes.has(symbol));
    const text = joinSections([
      {
        name: "comparison",
        text: `Comparison (${known.length} symbols; dividend-adjusted closes; risk figures describe the past year):\n${lines.join("\n")}${missing.length > 0 ? `\nNo data for: ${missing.join(", ")}.` : ""}`,
      },
      { name: "correlation", text: correlations.length > 0 ? `Correlation of daily returns over the past year: ${correlations.join(", ")}.` : null },
    ]);
    return { ok: true, text, subject: { en: `a comparison of ${known.join(", ")}`, zh: `${known.join("、")} 的比较` }, ...newestTrade(known.map((s) => quotes.get(s))) };
  } finally {
    budget.clear();
  }
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

function sectorLines(quotes: ReadonlyMap<string, Quote>): string[] {
  return SECTORS.map((sector) => {
    const constituents = sector.stocks.map((symbol) => quotes.get(symbol)).filter((quote): quote is Quote => quote !== undefined);
    return { sector, change: capWeightedChange(constituents), etf: quotes.get(sector.etf) };
  })
    .sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity))
    .map(({ sector, change, etf }) => `- ${sector.label.en}: ${fmtChangePercent(change)} (${sector.etf} ${fmtChangePercent(etf?.changePercent)})`);
}

/**
 * "today" while the US cash session trades; otherwise the last session by date, so that a note written on a weekend
 * does not call Friday's moves "today".
 */
export function sessionLabel(reference: Quote | undefined): string {
  if (!reference || reference.marketState === "REGULAR") return "today";
  const date = reference.regularMarketTime?.slice(0, 10);
  return date ? `in the latest session (${date})` : "in the latest session";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function moverLine(quote: Quote): string {
  return `${quote.symbol} ${fmtChangePercent(quote.changePercent)}`;
}

/** The two-line portfolio summary for the market and sector chats (null without positions). */
function summaryOfPositions(positions: readonly PositionInput[], quotes: ReadonlyMap<string, Quote>): string | null {
  if (positions.length === 0) return null;
  return portfolioSummary(
    valuePortfolio(positions, (symbol) => quotes.get(symbol)),
    positions.length,
  );
}

async function marketContext(positions: readonly PositionInput[] = []): Promise<ContextResult> {
  const symbols = unique([...MARKET_BOARD.map((item) => item.symbol), ...SECTORS.map((sector) => sector.etf), ...UNIVERSE_STOCKS, ...positions.map((p) => p.symbol)]);
  const budget = startBudget(LOAD_BUDGET_MS);
  try {
    const [quotesR, newsR] = await Promise.all([settle(attempt(() => getQuotes(symbols)), budget), settle(attempt(() => getMarketNews()), budget)]);
    const quotes = valueOf(quotesR) ?? new Map<string, Quote>();
    const news = valueOf(newsR);
    if (quotes.size === 0 && news === null) return UPSTREAM_FAILURE;

    const universe = UNIVERSE_STOCKS.map((symbol) => quotes.get(symbol)).filter(
      (quote): quote is Quote => quote !== undefined && isFiniteNumber(quote.changePercent),
    );
    const byChange = [...universe].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
    const reference = quotes.get(MARKET_STATE_SYMBOL);
    const session = sessionLabel(reference);
    const advancers = universe.filter((quote) => (quote.changePercent ?? 0) > 0).length;

    const sections: Section[] = [
      {
        name: "header",
        text: `US market snapshot. Cash-session state: ${reference?.marketState ?? NA} (from ${MARKET_STATE_SYMBOL}).`,
      },
      { name: "positions", text: summaryOfPositions(positions, quotes) },
      { name: "board", text: quotes.size > 0 ? `Board:\n${MARKET_BOARD.map((item) => boardLine(item, quotes.get(item.symbol))).join("\n")}` : "Board: not available." },
    ];
    if (universe.length > 0) {
      sections.push(
        { name: "sectors", text: `Sectors ${session} (cap-weighted constituent change, SPDR ETF change), strongest first:\n${sectorLines(quotes).join("\n")}` },
        {
          name: "movers",
          text: [
            `Large-cap universe (${universe.length} stocks): ${advancers} up, ${universe.length - advancers} down or flat.`,
            `- top gainers: ${byChange.slice(0, 5).map(moverLine).join(", ")}`,
            `- top losers: ${byChange.slice(-5).reverse().map(moverLine).join(", ")}`,
          ].join("\n"),
        },
      );
    }
    sections.push({ name: "headlines", text: headlineBlock(news, "Market headlines") });
    const live = session === "today";
    return {
      ok: true,
      text: joinSections(sections),
      subject: live ? { en: "the US market today", zh: "今日美股市场" } : { en: "the US market in its latest session", zh: "美股最近一个交易日" },
      dataAsOf: reference?.regularMarketTime ?? null,
      marketState: reference?.marketState ?? null,
    };
  } finally {
    budget.clear();
  }
}

// ---------------------------------------------------------------------------
// Sector
// ---------------------------------------------------------------------------

async function sectorContext(key: SectorKey, positions: readonly PositionInput[] = []): Promise<ContextResult> {
  const sector = getSector(key);
  if (!sector) return { ok: false, status: 404, code: "not_found", message: "Unknown sector." };
  const symbols = unique([sector.etf, ...sector.relatedEtfs, ...sector.stocks, MARKET_STATE_SYMBOL, ...positions.map((p) => p.symbol)]);
  const budget = startBudget(LOAD_BUDGET_MS);
  try {
    const [quotesR, newsR] = await Promise.all([settle(attempt(() => getQuotes(symbols)), budget), settle(attempt(() => getSectorNews(key)), budget)]);
    const quotes = valueOf(quotesR) ?? new Map<string, Quote>();
    const news = valueOf(newsR);
    if (quotes.size === 0 && news === null) return UPSTREAM_FAILURE;

    const constituents = sector.stocks
      .map((symbol) => quotes.get(symbol))
      .filter((quote): quote is Quote => quote !== undefined)
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    const sectorChange = capWeightedChange(constituents);
    const spxChange = quotes.get(MARKET_STATE_SYMBOL)?.changePercent ?? null;
    const gap = isFiniteNumber(sectorChange) && isFiniteNumber(spxChange) ? sectorChange - spxChange : null;
    const relative = gap !== null ? `; relative to the S&P 500: ${gap > 0 ? "+" : ""}${gap.toFixed(2)} pt` : "";
    const etfs = sector.relatedEtfs
      .map((symbol) => quotes.get(symbol))
      .filter((quote): quote is Quote => quote !== undefined)
      .map((quote) => `${quote.symbol} ${fmtPrice(quote.price)} (${fmtChangePercent(quote.changePercent)})`);
    const held = positions.filter((position) => sector.stocks.includes(position.symbol)).map((position) => position.symbol);

    const sections: Section[] = [
      { name: "header", text: `Sector: ${sector.label.en}. SPDR sector ETF: ${sector.etf}. Constituents tracked: ${sector.stocks.join(", ")}.` },
      {
        name: "positions",
        text: positions.length > 0 ? `${summaryOfPositions(positions, quotes) ?? ""}${held.length > 0 ? `\nHeld in this sector: ${held.join(", ")}.` : "\nNo position in this sector's tracked stocks."}` : null,
      },
      {
        name: "performance",
        text: [
          `Performance ${sessionLabel(quotes.get(MARKET_STATE_SYMBOL))}: cap-weighted constituents ${fmtChangePercent(sectorChange)}; S&P 500 ${fmtChangePercent(spxChange)}${relative}.`,
          etfs.length > 0 ? `- ETFs: ${etfs.join(", ")}` : "- ETFs: not available",
        ].join("\n"),
      },
      {
        name: "constituents",
        text: constituents.length > 0 ? `Constituents by market cap:\n${constituents.map(compactQuoteLine).join("\n")}` : "Constituents: quotes not available.",
      },
      { name: "headlines", text: headlineBlock(news, "Sector headlines") },
    ];
    const reference = quotes.get(MARKET_STATE_SYMBOL) ?? quotes.get(sector.etf);
    return {
      ok: true,
      text: joinSections(sections),
      subject: { en: `the ${sector.label.en} sector`, zh: `${sector.label.zh}板块` },
      dataAsOf: reference?.regularMarketTime ?? null,
      marketState: reference?.marketState ?? null,
    };
  } finally {
    budget.clear();
  }
}

// ---------------------------------------------------------------------------
// Watchlist and portfolio
// ---------------------------------------------------------------------------

const QUOTE_TYPE_GROUPS: Readonly<Record<string, string>> = {
  ETF: "ETFs and funds",
  MUTUALFUND: "ETFs and funds",
  CRYPTOCURRENCY: "Crypto",
  INDEX: "Indices",
  FUTURE: "Futures",
  CURRENCY: "Currencies",
};

export function sectorGroup(symbol: string, quoteType: string | null, yahooSector: string | null): string {
  const universe = sectorOfSymbol(symbol);
  if (universe) return universe.label.en;
  if (quoteType && QUOTE_TYPE_GROUPS[quoteType]) return QUOTE_TYPE_GROUPS[quoteType];
  const key = yahooSectorKey(yahooSector);
  const mapped = key ? getSector(key) : undefined;
  if (mapped) return mapped.label.en;
  return yahooSector ? cleanInline(yahooSector, 40) : "Unclassified";
}

function concentrationBlock(concentration: Concentration): string {
  const lines = [
    `Concentration of the watchlist rows (${concentration.holdings} symbols, equal count; market-cap weights cover ${concentration.withCap} of ${concentration.holdings}):`,
  ];
  if (concentration.largestByCount) {
    const top = concentration.largestByCount;
    lines.push(`- largest group by count: ${top.group} ${top.count}/${concentration.holdings} (${fmtShare(top.countShare)})`);
  }
  const topByCap = concentration.largestByCap;
  if (topByCap && topByCap.capShare !== null) {
    lines.push(`- largest group by market cap: ${topByCap.group} ${fmtShare(topByCap.capShare)}`);
  }
  const all = concentration.groups.map(
    (group) => `${group.group} ${group.count} (${fmtShare(group.countShare)}${group.capShare !== null ? `, cap ${fmtShare(group.capShare)}` : ""})`,
  );
  lines.push(`- all groups: ${all.join("; ")}`);
  return lines.join("\n");
}

export interface PositionRowInput {
  symbol: string;
  shares: number;
  cost: number;
}

/**
 * The investor's positions valued at the latest prices (lib/portfolio.ts): weight by market value, unrealized P&L and
 * today's impact, plus concentration by value. Amounts are not converted between currencies, so positions in another
 * currency and positions without a price are listed but left out of the totals. Returns null without positions.
 */
export function positionsBlock(
  positions: readonly PositionRowInput[],
  quotes: ReadonlyMap<string, Quote>,
  groupOf: (symbol: string) => string,
): string | null {
  if (positions.length === 0) return null;
  const { rows, foreign, unpriced, totals, baseCurrency } = valuePortfolio(positions, (symbol) => quotes.get(symbol));
  const unpricedLine = unpriced.length > 0 ? `No price for: ${unpriced.map((position) => position.symbol).join(", ")} (left out of the totals).` : null;
  if (rows.length === 0 && foreign.length === 0) return `Positions entered by the investor: ${unpricedLine ?? "none could be valued."}`;

  const pnlText = (row: ValuedPosition) => `unrealized ${fmtSigned(row.pnl)} (${fmtRatio(row.pnlPct, 1, true)})${row.dayPnl !== null ? `, day ${fmtSigned(row.dayPnl)}` : ""}`;

  const counts = [`${rows.length} in ${baseCurrency}`];
  if (foreign.length > 0) counts.push(`${foreign.length} in other currencies, not converted`);
  if (unpriced.length > 0) counts.push(`${unpriced.length} without a price`);
  const lines = [`Positions entered by the investor (${counts.join("; ")}):`];
  for (const row of rows) {
    lines.push(`- ${row.symbol}: ${shareCount(row.shares)} sh @ ${fmtPrice(row.cost)} -> value ${fmtNumber(row.value)} (${fmtShare(row.weight ?? 0)} of positions), ${pnlText(row)}; ${groupOf(row.symbol)}`);
  }
  for (const row of foreign) {
    lines.push(
      `- ${row.symbol}: ${shareCount(row.shares)} sh @ ${fmtPrice(row.cost)} ${row.currency} -> value ${fmtNumber(row.value)} ${row.currency}, ${pnlText(row)}; ${groupOf(row.symbol)}; not in the ${baseCurrency} totals`,
    );
  }
  if (unpricedLine) lines.push(unpricedLine);

  if (rows.length > 0) {
    const byGroup = new Map<string, number>();
    for (const row of rows) byGroup.set(groupOf(row.symbol), (byGroup.get(groupOf(row.symbol)) ?? 0) + row.value);
    const groups = [...byGroup.entries()].sort((a, b) => b[1] - a[1]).map(([group, value]) => `${group} ${fmtShare(value / totals.value)}`);
    const topThree = rows.slice(0, 3).reduce((sum, row) => sum + row.value, 0) / totals.value;
    lines.push(
      `Totals (${baseCurrency}): value ${fmtNumber(totals.value)}, cost ${fmtNumber(totals.costBasis)}, unrealized ${fmtSigned(totals.pnl)} (${fmtRatio(totals.pnlPct, 1, true)}), day ${fmtSigned(totals.dayPnl)}.`,
      `Largest position ${rows[0].symbol} ${fmtShare(rows[0].weight ?? 0)}; top 3 ${fmtShare(topThree)}. Weights by group (by value): ${groups.join("; ")}.`,
    );
  }
  return lines.join("\n");
}

/** Relevance a mover headline needs: it names the company, or it is a reliably tagged story led by the company. */
const MOVER_HEADLINE_SCORE = 45;

/**
 * A recent headline about `symbol` (named, or reliably tagged as its subject), excluding clickbait: the newest one
 * published before the session's last trade at `close` (epoch ms), which could explain the session, else the newest
 * later one. Without a finished session (`close` NaN) simply the newest.
 */
export function moverHeadline(symbol: string, name: string | null, items: readonly RawNewsItem[] | null, now: Date, close: number = Number.NaN): RawNewsItem | null {
  if (!items) return null;
  const since = now.getTime() - MOVE_NEWS_HOURS * 3_600_000;
  const matcher = buildCompanyMatcher(symbol, [name]);
  const recent = items
    .filter((item) => !isSpam(item.title))
    .filter((item) => companyScore(item, matcher) >= MOVER_HEADLINE_SCORE)
    .filter((item) => {
      const t = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN;
      return Number.isFinite(t) && t >= since;
    })
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return recent.find((item) => !publishedAfter(item, close)) ?? recent[0] ?? null;
}

function moverHeadlinesBlock(movers: readonly ValuedPosition[], news: ReadonlyArray<readonly RawNewsItem[] | null>, quotes: ReadonlyMap<string, Quote>, now: Date): string | null {
  if (movers.length === 0) return null;
  const lines = movers.map((row, i) => {
    const quote = quotes.get(row.symbol) ?? null;
    const close = sessionClose(quote);
    const item = moverHeadline(row.symbol, quote?.name ?? null, news[i] ?? null, now, close);
    const head = `- ${row.symbol} (day ${fmtSigned(row.dayPnl)})`;
    if (!item) return `${head}: no headline in the last ${MOVE_NEWS_HOURS} hours`;
    const after = publishedAfter(item, close) ? " (after the close)" : "";
    return `${head}: ${fmtTime(item.publishedAt)}${after} | ${cleanInline(item.publisher, 40) || "unknown publisher"}: ${cleanInline(item.title, 200)}`;
  });
  return `Latest headline for the two largest P&L movers (third-party text; it may not explain the move; "after the close" marks a story published after the session's last trade, which cannot explain the session's move):\n${untrusted(lines.join("\n"))}`;
}

async function watchlistContext(requestedSymbols: readonly string[], positions: readonly PositionInput[] = [], now: Date = new Date()): Promise<ContextResult> {
  // Positions come first, so a long watchlist never crowds them out of the rows, and every position is quoted even
  // beyond the row limit (the schema caps positions at MAX_WATCHLIST).
  const positionSymbols = unique(positions.map((position) => position.symbol));
  const requested = unique([...positionSymbols, ...requestedSymbols]);
  const symbols = requested.slice(0, MAX_WATCHLIST_ROWS);
  const quoteSymbols = unique([...symbols, ...positionSymbols]);
  const budget = startBudget(LOAD_BUDGET_MS);
  try {
    const quotesR = await settle(attempt(() => getQuotes(quoteSymbols)), budget);
    if (!quotesR.ok) return UPSTREAM_FAILURE;
    const quotes = quotesR.value;
    if (quotes.size === 0) return { ok: false, status: 404, code: "not_found", message: "None of the watchlist symbols were found." };

    // Sector names for equities outside the static universe come from the Yahoo profile (cached for hours).
    const lookups = unique([...symbols, ...positionSymbols])
      .filter((symbol) => {
        const quote = quotes.get(symbol);
        return quote !== undefined && !sectorOfSymbol(symbol) && (quote.quoteType === null || quote.quoteType === "EQUITY");
      })
      .slice(0, MAX_PROFILE_LOOKUPS);
    const portfolio = positions.length > 0 ? valuePortfolio(positions, (symbol) => quotes.get(symbol)) : null;
    const riskSymbols = portfolio ? portfolio.rows.slice(0, MAX_RISK_POSITIONS).map((row) => row.symbol) : [];
    const movers = portfolio ? largestMovers(portfolio) : [];
    const barsSymbols = riskSymbols.length > 0 ? unique([...riskSymbols, RISK_BENCHMARK]) : [];

    const [profiles, barsSettled, moverNews] = await Promise.all([
      Promise.all(lookups.map((symbol) => settle(attempt(() => getSummary(symbol)), budget))),
      Promise.all(barsSymbols.map((symbol) => settle(attempt(() => getDailyBars(symbol, BARS_LOOKBACK_DAYS)), budget))),
      Promise.all(movers.map((row) => settle(attempt(() => searchNews(row.symbol, MOVER_NEWS_COUNT)), budget))),
    ]);
    const yahooSectors = new Map(lookups.map((symbol, index) => [symbol, valueOf(profiles[index])?.profile.sector ?? null]));
    const groupOfSymbol = (symbol: string) => sectorGroup(symbol, quotes.get(symbol)?.quoteType ?? null, yahooSectors.get(symbol) ?? null);

    const missing = symbols.filter((symbol) => !quotes.has(symbol));
    const rows = symbols.flatMap((symbol) => {
      const quote = quotes.get(symbol);
      return quote ? [{ quote, group: groupOfSymbol(symbol) }] : [];
    });

    const withChange = rows.filter((row) => isFiniteNumber(row.quote.changePercent));
    const average = withChange.length > 0 ? withChange.reduce((sum, row) => sum + (row.quote.changePercent ?? 0), 0) / withChange.length : null;
    const byChange = [...withChange].sort((a, b) => (b.quote.changePercent ?? 0) - (a.quote.changePercent ?? 0));
    const session = sessionLabel(rows.find((row) => row.quote.quoteType === "EQUITY")?.quote ?? rows[0]?.quote);
    const truncated = requested.length > symbols.length ? ` (first ${symbols.length} of ${requested.length} shown)` : "";

    const sections: Section[] = [
      { name: "header", text: `Investor watchlist: ${rows.length} symbols with data${truncated}.${missing.length > 0 ? ` No data for: ${missing.join(", ")}.` : ""}` },
      {
        name: "moves",
        text:
          withChange.length > 0
            ? `${capitalize(session)}: equal-weighted average ${fmtChangePercent(average)}; best ${moverLine(byChange[0].quote)}; worst ${moverLine(byChange[byChange.length - 1].quote)}.`
            : `${capitalize(session)}: changes not available.`,
      },
    ];
    if (portfolio) {
      const barsBySymbol = new Map<string, DailyBar[]>();
      barsSymbols.forEach((symbol, i) => {
        const bars = valueOf(barsSettled[i]);
        if (Array.isArray(bars)) barsBySymbol.set(symbol, bars);
      });
      const aligned = alignCloses(barsSymbols, barsBySymbol, now.getTime() - RISK_WINDOW_DAYS * DAY_MS);
      sections.push(
        { name: "positions", text: positionsBlock(positions, quotes, groupOfSymbol) },
        { name: "day P&L", text: dayPnlLine(portfolio) },
        { name: "ranks", text: [ranksLine(portfolio), groupSplitLine(largestGroupSplit(portfolio, groupOfSymbol))].filter(Boolean).join("\n") },
        { name: "risk", text: riskBlock(portfolioRisk(aligned, portfolio, RISK_BENCHMARK, new Set(riskSymbols)), portfolio, RISK_BENCHMARK) },
        { name: "events", text: eventsLine(positionSymbols, quotes, now) },
        { name: "mover headlines", text: moverHeadlinesBlock(movers, moverNews.map((settled) => valueOf(settled)), quotes, now) },
      );
    } else {
      // Without positions the watchlist symbols stand in for holdings, so a question about upcoming reports has data.
      sections.push({ name: "events", text: eventsLine(symbols, quotes, now, "watchlist symbols") });
    }
    sections.push(
      { name: "concentration", text: concentrationBlock(computeConcentration(rows.map((row) => ({ group: row.group, marketCap: row.quote.marketCap })))) },
      {
        name: "holdings",
        text: `Watchlist rows (symbol name: price (change), valuation; group):\n${rows.map((row) => `${compactQuoteLine(row.quote)}; ${row.group}`).join("\n")}`,
      },
    );
    return {
      ok: true,
      text: joinSections(sections),
      subject: portfolio
        ? { en: `the investor's portfolio and watchlist (${rows.length} symbols)`, zh: `投资者的持仓与自选（${rows.length} 只）` }
        : { en: `the investor's watchlist (${rows.length} symbols)`, zh: `投资者的自选股（${rows.length} 只）` },
      ...newestTrade(quotes.values()),
    };
  } finally {
    budget.clear();
  }
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

interface NewsTarget {
  title: string;
  publisher: string | null;
  link: string;
  publishedAt: string | null;
  relatedTickers: string[];
  provenance: string | null;
}

function lookupNews(newsId: string): NewsItem | undefined {
  try {
    return findNewsById(newsId);
  } catch {
    return undefined;
  }
}

/** The cached news item, or the client-supplied link and title when the link passes the article allowlist. */
export function resolveNewsTarget(request: { newsId: string; link?: string; title?: string }): NewsTarget | null {
  const item = lookupNews(request.newsId);
  if (item) {
    const { title, publisher, link, publishedAt, relatedTickers, provenance } = item;
    return { title, publisher, link, publishedAt, relatedTickers, provenance };
  }
  const link = request.link ? parseArticleUrl(request.link) : null;
  const title = request.title?.trim();
  if (!link || !title) return null;
  return { title, publisher: null, link: link.href, publishedAt: null, relatedTickers: [], provenance: null };
}

async function newsContext(request: { newsId: string; link?: string; title?: string }): Promise<ContextResult> {
  const target = resolveNewsTarget(request);
  if (!target) {
    return { ok: false, status: 404, code: "not_found", message: "This news item is no longer available. Refresh the news list and try again." };
  }
  const tickers = unique(target.relatedTickers.map(normalizeSymbol).filter((symbol): symbol is string => symbol !== null)).slice(0, MAX_RELATED_TICKERS);
  const budget = startBudget(LOAD_BUDGET_MS);
  try {
    const [quotesR, articleR] = await Promise.all([
      settle(tickers.length > 0 ? attempt(() => getQuotes(tickers)) : Promise.resolve(new Map<string, Quote>()), budget),
      settle(loadArticle(target.link), budget),
    ]);
    const quotes = valueOf(quotesR);
    const article = valueOf(articleR);

    const metadata = [
      `Headline: ${cleanInline(target.title, 300)}`,
      `Publisher: ${cleanInline(target.publisher, 60) || "unknown"}`,
      `Published: ${fmtTime(target.publishedAt)}`,
      `Provenance: ${target.provenance ?? "unknown"}`,
      `Related tickers: ${tickers.length > 0 ? tickers.join(", ") : "none listed"}`,
    ].join("\n");
    const relatedLines = tickers
      .map((symbol) => quotes?.get(symbol))
      .filter((quote): quote is Quote => quote !== undefined)
      .map(compactQuoteLine);
    const related =
      tickers.length === 0
        ? "Related tickers: none listed."
        : relatedLines.length > 0
          ? `Related tickers today:\n${relatedLines.join("\n")}`
          : "Related tickers today: quotes not available.";
    const articleText = article
      ? `Article text (third-party, possibly truncated):\n${untrusted(article)}`
      : "Article text: not available (it could not be fetched). The analysis must be based on the headline and metadata only; say so.";

    const text = joinSections([
      { name: "news item", text: `News item (third-party text):\n${untrusted(metadata)}` },
      { name: "related tickers", text: related },
      { name: "article", text: articleText },
    ]);
    return { ok: true, text, subject: { en: "the news item in the data", zh: "数据中的这条新闻" }, dataAsOf: null, marketState: null };
  } finally {
    budget.clear();
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export async function buildAnalyzeContext(request: AnalyzeRequest, now: Date = new Date()): Promise<ContextResult> {
  switch (request.kind) {
    case "stock":
      return stockContext(request.symbol, now);
    case "move":
      return moveContext(request.symbol, now);
    case "market":
      return marketContext();
    case "sector":
      return sectorContext(request.sector);
    case "watchlist":
      return watchlistContext(request.symbols, request.positions ?? [], now);
    case "news":
      return newsContext(request);
  }
}

const VIEW_NOTES: Record<ChatContextInput["view"], string> = {
  market: "The investor is looking at the market overview.",
  stock: "The investor is looking at a stock page.",
  sector: "The investor is looking at a sector page.",
  watchlist: "The investor is looking at their watchlist.",
};

function withNote(result: ContextResult, note: string): ContextResult {
  return result.ok ? { ...result, text: `${note}\n\n${result.text}` } : result;
}

/**
 * Context for the chat: the subject of a seeded question when there is one (a move, a report, a comparison), else the
 * view the investor has open. Positions arrive only while the investor allows it.
 */
export async function buildChatContext(input: ChatContextInput, now: Date = new Date()): Promise<ContextResult> {
  const note = VIEW_NOTES[input.view];
  const positions = input.positions ?? [];
  const positionOf = (symbol: string) => positions.find((position) => position.symbol === symbol);
  const intent = input.intent;
  if (intent?.kind === "move") {
    return withNote(await moveContext(intent.symbol, now, { position: positionOf(intent.symbol) }), `${note} They asked why ${intent.symbol} is moving; the move breakdown below is the basis for the answer.`);
  }
  if (intent?.kind === "earnings") {
    return withNote(await stockContext(intent.symbol, now, { position: positionOf(intent.symbol) }), `${note} They asked about ${intent.symbol}'s earnings; use the Earnings and Analyst activity blocks.`);
  }
  if (intent?.kind === "compare") {
    return withNote(await compareContext(intent.symbols, now), `${note} They asked to compare ${intent.symbols.join(", ")}.`);
  }
  if (input.view === "stock" && input.symbol) return withNote(await stockContext(input.symbol, now, { position: positionOf(input.symbol) }), note);
  if (input.view === "sector" && input.sector) return withNote(await sectorContext(input.sector, positions), note);
  if (input.view === "watchlist") {
    const symbols = input.symbols ?? [];
    if (symbols.length > 0 || positions.length > 0) return withNote(await watchlistContext(symbols, positions, now), note);
    return withNote(await marketContext(positions), `${note} The watchlist is empty or was not sent, so the market overview is shown instead.`);
  }
  return withNote(await marketContext(positions), note);
}
