import "server-only";

import { evaluationVerdict, findHorizon, findLabel } from "@/lib/evaluation";
import { EVALUATION_DAYS, SIGNAL_EVALUATION } from "@/lib/evaluation-data";
import { valuePortfolio, type ValuedPosition } from "@/lib/portfolio";
import { labelForScore, SIGNAL_THRESHOLDS } from "@/lib/signal";
import { normalizeSymbol } from "@/lib/symbols";
import { getSector, MARKET_BOARD, MARKET_STATE_SYMBOL, SECTORS, sectorOfSymbol, UNIVERSE_STOCKS, type BoardSymbol } from "@/lib/universe";
import { yahooSectorKey } from "@/lib/sectors";
import type {
  AnalyzeRequest,
  ApiErrorCode,
  ChatRequest,
  KeyStats,
  Lang,
  NewsItem,
  Quote,
  SectorKey,
  SignalReport,
  StockProfile,
} from "@/types/api";

import { fetchArticleText, parseArticleUrl } from "./article";
import { HOUR, peek, put } from "./cache";
import { findNewsById, getCompanyNews, getMarketNews, getSectorNews } from "./news";
import { UNTRUSTED_CLOSE, UNTRUSTED_OPEN } from "./prompts";
import { getSignalReport } from "./signal-service";
import { getDailyBars, getQuote, getQuotes, getSummary, type DailyBar } from "./yahoo";

// Builds the live context for the AI from server-side data only. Each block is compact and whitelisted (no raw
// JSON), third-party text is wrapped in <untrusted_data> delimiters, and every source is loaded with a time budget
// so that a slow or failing source degrades to "not available" instead of failing the whole request.

export type ContextResult =
  | { ok: true; text: string; subject: Record<Lang, string> }
  | { ok: false; status: 404 | 502; code: ApiErrorCode; message: string };

export type ChatContextInput = ChatRequest["context"];

const MAX_CONTEXT_CHARS = 8_000;
/** Time budget for the parallel data loads of one context; slower sources are reported as not available. */
const LOAD_BUDGET_MS = 9_000;
const MAX_HEADLINES = 8;
const MAX_WATCHLIST_ROWS = 30;
/** Non-universe watchlist equities whose sector is looked up via the Yahoo profile. */
const MAX_PROFILE_LOOKUPS = 15;
const MAX_SUMMARY_CHARS = 500;
const MAX_RELATED_TICKERS = 5;
/** Same window as the signal engine (lib/server/signal-service.ts), so both share one cached chart request. */
const BARS_LOOKBACK_DAYS = 540;
const TRADING_DAYS = { month1: 21, month3: 63, month6: 126 } as const;

// ---------------------------------------------------------------------------
// Formatting (English, compact; the model translates when writing in Chinese)
// ---------------------------------------------------------------------------

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const NA = "n/a";

export function fmtNumber(value: number | null | undefined, digits = 2): string {
  if (!isFiniteNumber(value)) return NA;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPrice(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return NA;
  return fmtNumber(value, Math.abs(value) >= 1 ? 2 : 4);
}

/** Percent units: 1.234 -> "+1.23%". */
export function fmtChangePercent(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return NA;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** Decimal ratio: 0.2534 -> "25.3%" (or "+25.3%" when signed). */
export function fmtRatio(value: number | null | undefined, digits = 1, signed = false): string {
  if (!isFiniteNumber(value)) return NA;
  return `${signed && value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

export function fmtMultiple(value: number | null | undefined): string {
  return isFiniteNumber(value) ? `${value.toFixed(1)}x` : NA;
}

/** 4.61e12 -> "4.61T"; with USD -> "$4.61T"; other currencies are suffixed. */
export function fmtCompact(value: number | null | undefined, currency?: string | null): string {
  if (!isFiniteNumber(value)) return NA;
  const abs = Math.abs(value);
  const [divisor, unit] = abs >= 1e12 ? [1e12, "T"] : abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : [1, ""];
  const amount = `${(value / divisor).toFixed(divisor === 1 ? 0 : 2)}${unit}`;
  if (!currency) return amount;
  return currency === "USD" ? `${value < 0 ? "-" : ""}$${amount.replace("-", "")}` : `${amount} ${currency}`;
}

/** ISO timestamp to minute precision, e.g. "2026-11-07T14:05Z". */
function fmtTime(iso: string | null | undefined): string {
  return iso && iso.length >= 16 ? `${iso.slice(0, 16)}Z` : NA;
}

function fmtDate(iso: string | null | undefined): string {
  return iso && iso.length >= 10 ? iso.slice(0, 10) : NA;
}

/** "label value" pairs joined by commas, skipping missing values. */
function pairs(entries: ReadonlyArray<readonly [string, string]>): string {
  return entries
    .filter(([, value]) => value !== NA)
    .map(([label, value]) => `${label} ${value}`)
    .join(", ");
}

/** Third-party strings shown inline (names, reasons): no control or format characters, angle brackets or line breaks. */
export function cleanInline(value: string | null | undefined, maxChars = 80): string {
  if (!value) return "";
  const text = value
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/[<>\uFF1C\uFF1E\uFE64\uFE65]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/**
 * Wraps third-party text in the delimiters the system prompt tells the model to treat as data.
 * Angle brackets (and their full-width and small look-alikes) are replaced so the text can neither close the block
 * nor open a fake one.
 */
export function untrusted(text: string): string {
  const safe = text
    .replace(/[\p{Cc}\p{Cf}]/gu, (char) => (char === "\n" ? "\n" : " "))
    .replace(/[<\uFF1C\uFE64]/g, "‹")
    .replace(/[>\uFF1E\uFE65]/g, "›")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `${UNTRUSTED_OPEN}\n${safe}\n${UNTRUSTED_CLOSE}`;
}

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
  text: string;
}

/** Joins sections in priority order, skipping whole sections that would exceed the budget (never cutting one). */
export function joinSections(sections: readonly Section[], maxChars: number = MAX_CONTEXT_CHARS): string {
  const kept: string[] = [];
  const omitted: string[] = [];
  let length = 0;
  for (const section of sections) {
    const text = section.text.trim();
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
    return load();
  } catch (error) {
    return Promise.reject(error);
  }
}

function valueOf<T>(settled: Settled<T>): T | null {
  return settled.ok ? settled.value : null;
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

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

function stockHeader(symbol: string, quote: Quote | null, profile: StockProfile | null): string {
  const name = cleanInline(profile?.longName ?? profile?.name ?? quote?.name ?? symbol);
  const details = pairs([
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
  const lines = [
    `Quote (market state ${quote.marketState ?? NA}, last regular-session trade ${fmtTime(quote.regularMarketTime)}):`,
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

function statsBlock(stats: KeyStats | null, price: number | null, currency: string | null, now: Date): string {
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
      ["beta", fmtNumber(stats.beta)],
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
  if (isFiniteNumber(stats.targetMeanPrice)) {
    const implied = isFiniteNumber(price) && price > 0 ? ` (${fmtRatio(stats.targetMeanPrice / price - 1, 1, true)} vs the price)` : "";
    const range =
      isFiniteNumber(stats.targetLowPrice) && isFiniteNumber(stats.targetHighPrice)
        ? `, range ${fmtPrice(stats.targetLowPrice)}-${fmtPrice(stats.targetHighPrice)}`
        : "";
    const consensus = stats.recommendationKey ? `, consensus ${cleanInline(stats.recommendationKey, 20).replace(/_/g, " ")}` : "";
    const mean = isFiniteNumber(stats.recommendationMean) ? ` (mean rating ${stats.recommendationMean.toFixed(1)} on 1 = strong buy ... 5 = sell)` : "";
    const analysts = isFiniteNumber(stats.numberOfAnalysts) ? `, ${stats.numberOfAnalysts} analysts` : "";
    lines.push(`- Analysts: mean target ${fmtPrice(stats.targetMeanPrice)}${implied}${range}${consensus}${mean}${analysts}`);
  }
  const earnings = earningsLine(stats.nextEarningsDate, now);
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

function factorValue(raw: number | null, unit: SignalReport["factors"][number]["rawUnit"]): string {
  if (!isFiniteNumber(raw)) return "";
  if (unit === "percent") return ` (${fmtRatio(raw)})`;
  if (unit === "multiple") return ` (${fmtMultiple(raw)})`;
  return ` (${fmtNumber(raw, 1)})`;
}

/** Plain-language names of the signal codes: the score describes the current setup, it is not a forecast. */
const READING: Record<NonNullable<SignalReport["code"]>, string> = {
  strong_bullish: "very strong",
  bullish: "strong",
  neutral: "neutral",
  bearish: "weak",
  strong_bearish: "very weak",
};

const EVALUATION_VERDICT_TEXT = {
  predictive: "higher scores were followed by higher returns",
  inverse: "higher scores were followed by lower returns",
  none: "the score has not been a reliable forecast",
} as const;

/** One line from the offline universe evaluation (lib/signal-evaluation.json). */
export function evaluationLine(evaluation = SIGNAL_EVALUATION): string | null {
  const horizon = findHorizon(evaluation, EVALUATION_DAYS);
  if (!horizon) return null;
  const top = findLabel(horizon, "strong_bullish");
  const bottom = findLabel(horizon, "strong_bearish");
  const days = horizon.days;
  return (
    `- universe evaluation (${evaluation.universe} large US stocks, technical score, signals ${evaluation.from} to ${evaluation.to}): ` +
    `rank IC with ${days}-day forward returns ${fmtNumber(horizon.ic.mean, 3)} (t ${fmtNumber(horizon.ic.t, 2)}), so ${EVALUATION_VERDICT_TEXT[evaluationVerdict(horizon)]}; ` +
    `average ${days}-day excess return after very strong readings ${fmtRatio(top?.excess, 2, true)}, after very weak readings ${fmtRatio(bottom?.excess, 2, true)}`
  );
}

function signalBlock(report: SignalReport | null): string {
  if (!report) return "InvestSeek model signal: not available.";
  if (report.status !== "ok" || report.code === null) {
    const reason = cleanInline(report.reason, 120);
    return `InvestSeek model signal: insufficient data${reason ? ` (${reason})` : ""}.`;
  }
  const round = (value: number | null) => (isFiniteNumber(value) ? String(Math.round(value)) : NA);
  const lines = [
    "InvestSeek model signal:",
    `- reading: ${READING[report.code]}, score ${round(report.score)}/100, factor agreement ${round(report.consensus)}/100, data coverage ${round(report.coverage)}/100, clarity ${report.confidence ?? NA} (agreement and coverage, not forecast confidence)`,
  ];
  if (isFiniteNumber(report.technicalScore)) {
    lines.push(`- technical-only score (what the backtest and the universe evaluation measure): ${report.technicalScore.toFixed(1)}, reading ${READING[labelForScore(report.technicalScore)]}`);
  }
  const informative = [...report.factors.filter((factor) => !factor.imputed)].sort((a, b) => b.score - a.score);
  const describe = (factor: SignalReport["factors"][number]) => `${factor.key} ${Math.round(factor.score)}${factorValue(factor.raw, factor.rawUnit)}`;
  if (informative.length >= 4) {
    lines.push(`- strongest factors: ${informative.slice(0, 2).map(describe).join(", ")}; weakest: ${informative.slice(-2).reverse().map(describe).join(", ")}`);
  } else if (informative.length > 0) {
    lines.push(`- factors (0-100, higher reads stronger): ${informative.map(describe).join(", ")}`);
  }
  const backtest = report.backtest;
  const fiveDay = backtest?.results.find((result) => result.holdDays === 5);
  if (backtest && fiveDay) {
    const ci = fiveDay.winRateCI ? ` (95% CI ${fmtRatio(fiveDay.winRateCI[0])}-${fmtRatio(fiveDay.winRateCI[1])})` : "";
    lines.push(
      `- backtest of strong readings (score >= ${SIGNAL_THRESHOLDS.bullish}), technical factors only, 5-day hold over ${fiveDay.windowDays} sessions, ${backtest.costBps} bps round-trip cost: ` +
        `${fiveDay.trades} trades, win rate ${fmtRatio(fiveDay.winRate)}${ci} vs baseline ${fmtRatio(fiveDay.baselineWinRate)}, ` +
        `average return ${fmtRatio(fiveDay.avgReturn, 2, true)} vs baseline ${fmtRatio(fiveDay.baselineAvgReturn, 2, true)} (edge ${fmtRatio(fiveDay.edge, 2, true)})` +
        (fiveDay.lowSample ? "; fewer than 20 trades, so these statistics are not meaningful" : ""),
    );
  } else {
    lines.push("- backtest: not available");
  }
  const evaluation = evaluationLine();
  if (evaluation) lines.push(evaluation);
  lines.push(
    "- limits: the live score mixes technical and fundamental factors, but the backtest can only test the technical factors because historical fundamentals are not available; past results do not predict future returns",
  );
  return lines.join("\n");
}

function profileBlock(profile: StockProfile | null): string {
  const summary = profile?.summary?.trim();
  if (!summary) return "";
  const clipped = summary.length > MAX_SUMMARY_CHARS ? `${summary.slice(0, MAX_SUMMARY_CHARS - 1)}…` : summary;
  return `Business description (third-party text):\n${untrusted(clipped)}`;
}

async function stockContext(symbol: string, now: Date): Promise<ContextResult> {
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
    const [quoteR, summaryR, barsR, signalR, newsR] = await Promise.all([
      settle(quotePromise, budget),
      settle(summaryPromise, budget),
      settle(attempt(() => getDailyBars(symbol, BARS_LOOKBACK_DAYS)), budget),
      settle(attempt(() => getSignalReport(symbol)), budget),
      settle(newsPromise, budget),
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

    const text = joinSections([
      { name: "header", text: stockHeader(symbol, quote, profile) },
      { name: "quote", text: quoteBlock(quote, stats) },
      { name: "key statistics", text: statsBlock(stats, quote?.price ?? null, currency, now) },
      { name: "technicals", text: technicalsBlock(valueOf(barsR)) },
      { name: "model signal", text: signalBlock(valueOf(signalR)) },
      { name: "headlines", text: headlineBlock(valueOf(newsR)) },
      { name: "business description", text: profileBlock(profile) },
    ]);
    return { ok: true, text, subject: { en: `${symbol} (${name})`, zh: `${symbol}（${name}）` } };
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

async function marketContext(): Promise<ContextResult> {
  const symbols = [...new Set([...MARKET_BOARD.map((item) => item.symbol), ...SECTORS.map((sector) => sector.etf), ...UNIVERSE_STOCKS])];
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
    const session = sessionLabel(quotes.get(MARKET_STATE_SYMBOL));
    const advancers = universe.filter((quote) => (quote.changePercent ?? 0) > 0).length;

    const sections: Section[] = [
      {
        name: "header",
        text: `US market snapshot. Cash-session state: ${quotes.get(MARKET_STATE_SYMBOL)?.marketState ?? NA} (from ${MARKET_STATE_SYMBOL}).`,
      },
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
    };
  } finally {
    budget.clear();
  }
}

// ---------------------------------------------------------------------------
// Sector
// ---------------------------------------------------------------------------

async function sectorContext(key: SectorKey): Promise<ContextResult> {
  const sector = getSector(key);
  if (!sector) return { ok: false, status: 404, code: "not_found", message: "Unknown sector." };
  const symbols = [...new Set([sector.etf, ...sector.relatedEtfs, ...sector.stocks, MARKET_STATE_SYMBOL])];
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

    const sections: Section[] = [
      { name: "header", text: `Sector: ${sector.label.en}. SPDR sector ETF: ${sector.etf}. Constituents tracked: ${sector.stocks.join(", ")}.` },
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
    return {
      ok: true,
      text: joinSections(sections),
      subject: { en: `the ${sector.label.en} sector`, zh: `${sector.label.zh}板块` },
    };
  } finally {
    budget.clear();
  }
}

// ---------------------------------------------------------------------------
// Watchlist
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

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function concentrationBlock(concentration: Concentration): string {
  const lines = [
    `Concentration (${concentration.holdings} holdings, equal count; market-cap weights cover ${concentration.withCap} of ${concentration.holdings}):`,
  ];
  if (concentration.largestByCount) {
    const top = concentration.largestByCount;
    lines.push(`- largest group by count: ${top.group} ${top.count}/${concentration.holdings} (${pct(top.countShare)})`);
  }
  const topByCap = concentration.largestByCap;
  if (topByCap && topByCap.capShare !== null) {
    lines.push(`- largest group by market cap: ${topByCap.group} ${pct(topByCap.capShare)}`);
  }
  const all = concentration.groups.map(
    (group) => `${group.group} ${group.count} (${pct(group.countShare)}${group.capShare !== null ? `, cap ${pct(group.capShare)}` : ""})`,
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

  const signed = (value: number) => `${value >= 0 ? "+" : "-"}${fmtNumber(Math.abs(value))}`;
  const shares = (value: number) => fmtNumber(value, Number.isInteger(value) ? 0 : 4);
  const pnlText = (row: ValuedPosition) => `unrealized ${signed(row.pnl)} (${fmtRatio(row.pnlPct, 1, true)})${row.dayPnl !== null ? `, day ${signed(row.dayPnl)}` : ""}`;

  const counts = [`${rows.length} in ${baseCurrency}`];
  if (foreign.length > 0) counts.push(`${foreign.length} in other currencies, not converted`);
  if (unpriced.length > 0) counts.push(`${unpriced.length} without a price`);
  const lines = [`Positions entered by the investor (${counts.join("; ")}):`];
  for (const row of rows) {
    lines.push(`- ${row.symbol}: ${shares(row.shares)} sh @ ${fmtPrice(row.cost)} -> value ${fmtNumber(row.value)} (${pct(row.weight ?? 0)} of positions), ${pnlText(row)}; ${groupOf(row.symbol)}`);
  }
  for (const row of foreign) {
    lines.push(
      `- ${row.symbol}: ${shares(row.shares)} sh @ ${fmtPrice(row.cost)} ${row.currency} -> value ${fmtNumber(row.value)} ${row.currency}, ${pnlText(row)}; ${groupOf(row.symbol)}; not in the ${baseCurrency} totals`,
    );
  }
  if (unpricedLine) lines.push(unpricedLine);

  if (rows.length > 0) {
    const byGroup = new Map<string, number>();
    for (const row of rows) byGroup.set(groupOf(row.symbol), (byGroup.get(groupOf(row.symbol)) ?? 0) + row.value);
    const groups = [...byGroup.entries()].sort((a, b) => b[1] - a[1]).map(([group, value]) => `${group} ${pct(value / totals.value)}`);
    const topThree = rows.slice(0, 3).reduce((sum, row) => sum + row.value, 0) / totals.value;
    lines.push(
      `Totals (${baseCurrency}): value ${fmtNumber(totals.value)}, cost ${fmtNumber(totals.costBasis)}, unrealized ${signed(totals.pnl)} (${fmtRatio(totals.pnlPct, 1, true)}), day ${signed(totals.dayPnl)}.`,
      `Largest position ${rows[0].symbol} ${pct(rows[0].weight ?? 0)}; top 3 ${pct(topThree)}. Weights by group (by value): ${groups.join("; ")}.`,
    );
  }
  return lines.join("\n");
}

async function watchlistContext(requestedSymbols: readonly string[], positions: readonly PositionRowInput[] = []): Promise<ContextResult> {
  // Positions come first, so a long watchlist never crowds them out of the rows, and every position is quoted even
  // beyond the row limit (the schema caps positions at MAX_WATCHLIST).
  const positionSymbols = [...new Set(positions.map((position) => position.symbol))];
  const requested = [...new Set([...positionSymbols, ...requestedSymbols])];
  const symbols = requested.slice(0, MAX_WATCHLIST_ROWS);
  const quoteSymbols = [...new Set([...symbols, ...positionSymbols])];
  const budget = startBudget(LOAD_BUDGET_MS);
  try {
    const quotesR = await settle(attempt(() => getQuotes(quoteSymbols)), budget);
    if (!quotesR.ok) return UPSTREAM_FAILURE;
    const quotes = quotesR.value;
    if (quotes.size === 0) return { ok: false, status: 404, code: "not_found", message: "None of the watchlist symbols were found." };

    // Sector names for equities outside the static universe come from the Yahoo profile (cached for hours).
    const lookups = symbols
      .filter((symbol) => {
        const quote = quotes.get(symbol);
        return quote !== undefined && !sectorOfSymbol(symbol) && (quote.quoteType === null || quote.quoteType === "EQUITY");
      })
      .slice(0, MAX_PROFILE_LOOKUPS);
    const profiles = await Promise.all(lookups.map((symbol) => settle(attempt(() => getSummary(symbol)), budget)));
    const yahooSectors = new Map(lookups.map((symbol, index) => [symbol, valueOf(profiles[index])?.profile.sector ?? null]));

    const missing = symbols.filter((symbol) => !quotes.has(symbol));
    const rows = symbols.flatMap((symbol) => {
      const quote = quotes.get(symbol);
      return quote ? [{ quote, group: sectorGroup(symbol, quote.quoteType, yahooSectors.get(symbol) ?? null) }] : [];
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
      { name: "concentration", text: concentrationBlock(computeConcentration(rows.map((row) => ({ group: row.group, marketCap: row.quote.marketCap })))) },
    ];
    const groupBySymbol = new Map(rows.map((row) => [row.quote.symbol, row.group]));
    const positionsText = positions.length > 0 ? positionsBlock(positions, quotes, (symbol) => groupBySymbol.get(symbol) ?? "Unclassified") : null;
    if (positionsText) sections.push({ name: "positions", text: positionsText });
    sections.push({
      name: "holdings",
      text: `Holdings (symbol name: price (change), valuation; group):\n${rows.map((row) => `${compactQuoteLine(row.quote)}; ${row.group}`).join("\n")}`,
    });
    return {
      ok: true,
      text: joinSections(sections),
      subject: positionsText
        ? { en: `the investor's portfolio and watchlist (${rows.length} symbols)`, zh: `投资者的持仓与自选（${rows.length} 只）` }
        : { en: `the investor's watchlist (${rows.length} symbols)`, zh: `投资者的自选股（${rows.length} 只）` },
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

/**
 * Article text, cached for an hour so that re-analyzing a headline does not fetch the page again. Failures are not
 * cached: a timeout or an unreadable page is retried on the next request.
 */
async function loadArticle(link: string): Promise<string | null> {
  const key = `article:${link}`;
  const hit = peek<string>(key);
  if (hit !== undefined) return hit;
  const text = await fetchArticleText(link);
  if (text !== null) put(key, text, { ttlMs: HOUR });
  return text;
}

async function newsContext(request: { newsId: string; link?: string; title?: string }): Promise<ContextResult> {
  const target = resolveNewsTarget(request);
  if (!target) {
    return { ok: false, status: 404, code: "not_found", message: "This news item is no longer available. Refresh the news list and try again." };
  }
  const tickers = [...new Set(target.relatedTickers.map(normalizeSymbol).filter((symbol): symbol is string => symbol !== null))].slice(
    0,
    MAX_RELATED_TICKERS,
  );
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
    return { ok: true, text, subject: { en: "the news item in the data", zh: "数据中的这条新闻" } };
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
    case "market":
      return marketContext();
    case "sector":
      return sectorContext(request.sector);
    case "watchlist":
      return watchlistContext(request.symbols, request.positions ?? []);
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

/** Context for the chat, based on the view the investor has open. */
export async function buildChatContext(input: ChatContextInput, now: Date = new Date()): Promise<ContextResult> {
  const note = VIEW_NOTES[input.view];
  if (input.view === "stock" && input.symbol) return withNote(await stockContext(input.symbol, now), note);
  if (input.view === "sector" && input.sector) return withNote(await sectorContext(input.sector), note);
  if (input.view === "watchlist") {
    if (input.symbols && input.symbols.length > 0) return withNote(await watchlistContext(input.symbols), note);
    return withNote(await marketContext(), `${note} The watchlist is empty or was not sent, so the market overview is shown instead.`);
  }
  return withNote(await marketContext(), note);
}
