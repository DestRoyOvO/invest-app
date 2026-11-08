import "server-only";

import type { DailyBar } from "@/lib/bars";
import { crossSectionalPercentiles, FACTOR_KEYS, styleFactorsAt, type DatedClose } from "@/lib/factors";
import { latestTechnicalScore, wilderRsiSeries } from "@/lib/signal";
import { ETF_UNIVERSE, newYorkDate, universeSymbols } from "@/lib/screens";
import { percentileRank } from "@/lib/stats";
import { sectorOfSymbol } from "@/lib/universe";
import type { FactorProfile, Quote, ScreenerResponse, ScreenerRow, ScreenerUniverse, StyleFactorKey } from "@/types/api";
import type { ScreenRow } from "@/types/screener";

import { cached, HOUR, MINUTE } from "./cache";
import { dropPartialBar } from "./signal-service";
import { getDailyBars, getQuotes, todayInExchange } from "./yahoo";

// The screener snapshot: one row per universe symbol with valuation and dividend fields from the batched quote, plus
// returns, RSI, the model's technical reading and the style factors (lib/factors.ts) from daily bars. The snapshot is
// shared by every visitor and rebuilt at most every 10 minutes; daily bars come from the same cached request as the
// quant signal, so a symbol whose quote page was opened costs nothing extra. Rows carry the ScreenerRow contract plus
// the dividend columns in types/screener.ts; filtering, sorting and export happen in the browser (lib/screens.ts).

/** Calendar days of daily bars: the signal engine's request, long enough for 12-1 momentum and 252-session beta. */
const HISTORY_DAYS = 540;
const BENCHMARK = "SPY";
const SNAPSHOT_TTL_MS = 10 * MINUTE;
const SNAPSHOT_STALE_MS = 2 * HOUR;

/** The ETF universe and the symbols of each universe live with the screener model (lib/screens.ts), shared with the client. */
export { ETF_UNIVERSE, universeSymbols };

const EMPTY_FACTORS: Record<StyleFactorKey, number | null> = { momentum: null, reversal: null, high52: null, volatility: null, beta: null };

function ratio(a: number | null, b: number | null): number | null {
  return a !== null && b !== null && a > 0 && b > 0 ? a / b - 1 : null;
}

function trailingReturn(closes: readonly number[], sessions: number): number | null {
  const n = closes.length;
  return n > sessions ? ratio(closes[n - 1], closes[n - 1 - sessions]) : null;
}

/** Completed sessions only: today's forming bar is dropped while the regular session trades. */
function completedBars(bars: readonly DailyBar[], quote: Quote | undefined): readonly DailyBar[] {
  return dropPartialBar(bars, quote?.marketState ?? null, todayInExchange()).bars;
}

function dated(bars: readonly DailyBar[]): DatedClose[] {
  return bars.map((bar) => ({ t: bar.t, c: bar.adjClose }));
}

/** Bar-based columns of one row. Exported for tests. */
export function barMetrics(bars: readonly DailyBar[], benchmark: readonly DatedClose[] | null) {
  const series = dated(bars);
  const closes = series.map((point) => point.c);
  const rsi = wilderRsiSeries(closes);
  return {
    return1m: trailingReturn(closes, 21),
    return3m: trailingReturn(closes, 63),
    return6m: trailingReturn(closes, 126),
    rsi14: rsi.length ? rsi[rsi.length - 1] : null,
    technicalScore: latestTechnicalScore(bars),
    factors: series.length ? styleFactorsAt(series, benchmark) : { ...EMPTY_FACTORS },
  };
}

/**
 * The ex-dividend date when it falls today or later in New York, else null. Yahoo keeps the latest dividend in the
 * quote's corporate actions for a while after it goes ex, and a past date would read as an upcoming one (and sort
 * first by ex-date). `today` is UTC midnight of the New York date (todayInExchange). Exported for tests.
 */
export function upcomingExDate(iso: string | null, today: number): string | null {
  if (iso === null) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Date.parse(`${newYorkDate(at)}T00:00:00Z`) >= today ? iso : null;
}

/** Quote-based columns of one row (no extra Yahoo call: everything comes from the batched quote). Exported for tests. */
export function quoteColumns(symbol: string, quote: Quote | undefined, today: number = todayInExchange()) {
  const price = quote?.price ?? null;
  return {
    symbol,
    name: quote?.name ?? symbol,
    sector: sectorOfSymbol(symbol)?.key ?? null,
    quoteType: quote?.quoteType ?? null,
    price,
    changePercent: quote?.changePercent ?? null,
    marketCap: quote?.marketCap ?? null,
    trailingPE: quote?.trailingPE ?? null,
    forwardPE: quote?.forwardPE ?? null,
    priceToBook: quote?.priceToBook ?? null,
    dividendYield: quote?.dividendYield ?? null,
    dividendRate: quote?.dividendRate ?? null,
    exDividendDate: upcomingExDate(quote?.exDividendDate ?? null, today),
    analystRating: quote?.analystRating ?? null,
    nextEarningsDate: quote?.nextEarningsDate ?? null,
    earningsDateEstimated: quote?.earningsDateEstimated ?? null,
    fromHigh52: ratio(price, quote?.fiftyTwoWeekHigh ?? null),
    vs50d: ratio(price, quote?.fiftyDayAverage ?? null),
    vs200d: ratio(price, quote?.twoHundredDayAverage ?? null),
    dollarVolume: price !== null && quote?.avgVolume ? price * quote.avgVolume : null,
    expenseRatio: quote?.expenseRatio ?? null,
    netAssets: quote?.netAssets ?? null,
    ytdReturnPercent: quote?.ytdReturnPercent ?? null,
  };
}

/** Adds universe percentiles of every style factor to the rows (in place) and returns them. Exported for tests. */
export function rankFactors(rows: ScreenerRow[]): ScreenerRow[] {
  for (const key of FACTOR_KEYS) {
    const percentiles = crossSectionalPercentiles(new Map(rows.map((row) => [row.symbol, row.factors[key]])));
    for (const row of rows) row.percentiles[key] = percentiles.get(row.symbol) ?? null;
  }
  return rows;
}

async function settledBars(symbol: string): Promise<DailyBar[] | null> {
  try {
    return await getDailyBars(symbol, HISTORY_DAYS);
  } catch {
    return null;
  }
}

async function buildSnapshot(universe: ScreenerUniverse): Promise<ScreenerResponse> {
  const symbols = universeSymbols(universe);
  const [quotes, benchmarkBars, ...barsList] = await Promise.all([
    getQuotes([...new Set([...symbols, BENCHMARK])]),
    settledBars(BENCHMARK),
    ...symbols.map(settledBars),
  ]);
  const benchmark = benchmarkBars ? dated(completedBars(benchmarkBars, quotes.get(BENCHMARK))) : null;

  const warnings: string[] = [];
  if (!benchmark) warnings.push("benchmark");
  const partial: string[] = [];
  const today = todayInExchange();
  const rows: ScreenRow[] = symbols.map((symbol, i) => {
    const quote = quotes.get(symbol);
    const bars = barsList[i];
    if (!bars) partial.push(symbol);
    const metrics = bars ? barMetrics(completedBars(bars, quote), benchmark) : null;
    return {
      ...quoteColumns(symbol, quote, today),
      return1m: metrics?.return1m ?? null,
      return3m: metrics?.return3m ?? null,
      return6m: metrics?.return6m ?? null,
      rsi14: metrics?.rsi14 ?? null,
      technicalScore: metrics?.technicalScore ?? null,
      factors: metrics?.factors ?? { ...EMPTY_FACTORS },
      percentiles: { ...EMPTY_FACTORS },
    };
  });
  if (quotes.size === 0 && partial.length === symbols.length) throw new Error("Screener: no market data could be loaded");
  if (partial.length > 0) warnings.push("history");
  if (symbols.some((symbol) => quotes.get(symbol)?.stale)) warnings.push("quotes_stale");

  return { asOf: new Date().toISOString(), universe, rows: rankFactors(rows), partial, warnings };
}

/** The universe snapshot (cached 10 minutes, served stale for up to 2 hours if a rebuild fails). */
export function getScreener(universe: ScreenerUniverse): Promise<ScreenerResponse> {
  return cached(`screener:${universe}`, { ttlMs: SNAPSHOT_TTL_MS, staleMs: SNAPSHOT_STALE_MS }, () => buildSnapshot(universe));
}

/**
 * Style factor values of any symbol, with percentiles against the stock universe's current values. Universe members
 * reuse their snapshot row; other symbols are computed from their own bars. Null when the symbol has no history.
 */
export async function getFactorProfile(symbol: string): Promise<FactorProfile | null> {
  const snapshot = await getScreener("stocks");
  const own = snapshot.rows.find((row) => row.symbol === symbol);
  const universeSize = snapshot.rows.filter((row) => FACTOR_KEYS.some((key) => row.factors[key] !== null)).length;
  if (own) {
    return { symbol, asOf: snapshot.asOf, values: own.factors, percentiles: own.percentiles, universeSize, inUniverse: true };
  }

  const [bars, benchmarkBars, quotes] = await Promise.all([
    getDailyBars(symbol, HISTORY_DAYS),
    settledBars(BENCHMARK),
    getQuotes([symbol, BENCHMARK]),
  ]);
  if (bars.length === 0) return null;
  const benchmark = benchmarkBars ? dated(completedBars(benchmarkBars, quotes.get(BENCHMARK))) : null;
  const values = styleFactorsAt(dated(completedBars(bars, quotes.get(symbol))), benchmark);
  const percentiles = { ...EMPTY_FACTORS };
  for (const key of FACTOR_KEYS) {
    const value = values[key];
    const others = snapshot.rows.map((row) => row.factors[key]).filter((v): v is number => v !== null);
    percentiles[key] = value === null ? null : percentileRank(others, value);
  }
  return { symbol, asOf: new Date().toISOString(), values, percentiles, universeSize, inUniverse: false };
}
