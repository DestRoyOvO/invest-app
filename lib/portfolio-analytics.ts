// Portfolio analytics for the portfolio page (PORT, CORR): exposure by value, the past risk of today's holdings,
// correlations, and how today's positions would have performed. Pure functions over valued positions
// (lib/portfolio.ts) and aligned daily closes (/api/history); the statistics themselves come from lib/risk.ts.
//
// Everything here describes the past behaviour of the positions held today. It is not the investor's actual return
// (that needs a trade ledger) and not a forecast.

import type { ValuedPosition } from "./portfolio";
import {
  annualizedVolatility,
  beta,
  correlation,
  covarianceMatrix,
  dailyReturns,
  drawdownSeries,
  effectivePositions,
  historicalVar,
  holdingsValueSeries,
  maxDrawdown,
  MIN_RETURNS,
  periodReturn,
  rebase,
  riskContributions,
  type AlignedCloses,
  type Drawdown,
} from "./risk";
import { holdingGroup, holdingGroupId, type HoldingGroup } from "./sectors";
import { isFiniteNumber, mean } from "./stats";

/** /api/history takes 25 symbols: the 24 largest positions plus the benchmark. */
export const MAX_ANALYZED = 24;
export const BENCHMARK = "SPY";
/** Pairs whose daily returns correlate at least this much are flagged as moving together. */
export const HIGH_CORRELATION = 0.8;
export const VAR_CONFIDENCE = 0.95;
/** The risk statistics cover the last year of sessions (252 daily returns), the same window as the 1Y chart. */
export const RISK_SESSIONS = 252;

type Series = ReadonlyArray<number | null>;

function isPrice(value: number | null | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
}

// ---------------------------------------------------------------------------
// Which positions are analyzed
// ---------------------------------------------------------------------------

export interface AnalysisSelection {
  /** The largest base-currency positions by value, at most MAX_ANALYZED. */
  analyzed: ValuedPosition[];
  /** Further base-currency positions, left out of the risk analysis (still in value and exposure). */
  beyond: ValuedPosition[];
}

export function selectAnalyzed(rows: readonly ValuedPosition[], max = MAX_ANALYZED): AnalysisSelection {
  const sorted = [...rows].sort((a, b) => b.value - a.value || a.symbol.localeCompare(b.symbol));
  return { analyzed: sorted.slice(0, max), beyond: sorted.slice(max) };
}

/** Symbols to request from /api/history: the analyzed positions, then the benchmark (once). */
export function historySymbols(analyzed: ReadonlyArray<{ symbol: string }>, benchmark = BENCHMARK): string[] {
  return [...new Set([...analyzed.map((p) => p.symbol), benchmark])];
}

/**
 * The history restricted to the benchmark's sessions (US trading days for SPY). Other symbols carry their last close
 * forward over their own holidays, and a close on a dropped session (crypto on a weekend) counts on the next kept
 * session. Returned unchanged when the benchmark has no closes.
 */
export function onBenchmarkSessions(history: AlignedCloses, benchmark: string): AlignedCloses {
  const bench = history.closes[benchmark];
  if (!bench || !bench.some(isPrice)) return history;
  const keep = new Set<number>();
  bench.forEach((close, i) => {
    if (isPrice(close)) keep.add(i);
  });
  const closes: Record<string, Array<number | null>> = {};
  for (const [symbol, series] of Object.entries(history.closes)) {
    let last: number | null = null;
    const out: Array<number | null> = [];
    for (let i = 0; i < history.dates.length; i++) {
      const close = series[i];
      if (isPrice(close)) last = close;
      if (keep.has(i)) out.push(last);
    }
    closes[symbol] = out;
  }
  return { dates: history.dates.filter((_, i) => keep.has(i)), closes };
}

/** The last `count` sessions of an aligned history. */
export function lastSessions(history: AlignedCloses, count: number): AlignedCloses {
  const start = Math.max(0, history.dates.length - count);
  if (start === 0) return history;
  const closes: Record<string, Array<number | null>> = {};
  for (const [symbol, series] of Object.entries(history.closes)) closes[symbol] = series.slice(start);
  return { dates: history.dates.slice(start), closes };
}

/** A series on other dates looked up by date onto `dates` (null where it has no close that day). */
export function alignByDate(dates: readonly number[], source: { dates: readonly number[]; closes: Series }): Array<number | null> {
  const byDate = new Map<number, number | null>();
  source.dates.forEach((date, i) => byDate.set(date, source.closes[i] ?? null));
  return dates.map((date) => {
    const close = byDate.get(date);
    return isPrice(close) ? close : null;
  });
}

// ---------------------------------------------------------------------------
// Risk of today's holdings
// ---------------------------------------------------------------------------

export interface PositionRisk {
  symbol: string;
  value: number;
  /** Share of the analyzed value. */
  weight: number;
  /** Share of the variance of the holdings' daily returns (Euler allocation; negative lowers it); null if unknown. */
  riskShare: number | null;
  /** Beta of the position's daily returns to the benchmark over the same sessions. */
  beta: number | null;
  /** Annualized volatility of the position's daily returns over the same sessions. */
  volatility: number | null;
}

export interface CorrelationPair {
  a: string;
  b: string;
  r: number;
}

export interface CorrelationMatrix {
  symbols: string[];
  /** Pearson correlation of daily returns; 1 on the diagonal; null when there are too few shared sessions. */
  matrix: Array<Array<number | null>>;
  /** Pairs at HIGH_CORRELATION or above, strongest first. */
  high: CorrelationPair[];
  /** Mean of the pairwise correlations. */
  average: number | null;
}

export interface DatedDrawdown extends Drawdown {
  peakDate: number;
  troughDate: number;
}

export interface RiskReport {
  /** Analyzed symbols with price history, largest value first. */
  symbols: string[];
  /** Analyzed symbols without a single close in the history. */
  missingHistory: string[];
  /** Today's value of `symbols` at the latest quotes. */
  value: number;
  /** Sessions of the analysis: the benchmark's sessions when it has history. */
  dates: number[];
  /** What today's shares were worth on each session; null before every analyzed symbol has a close. */
  values: Array<number | null>;
  /** Benchmark closes on the same sessions; all null when the benchmark has no history. */
  benchmark: Array<number | null>;
  /** Daily returns of `values`. */
  returns: Array<number | null>;
  /** Number of daily returns behind the statistics. */
  sessions: number;
  /** First session on which every analyzed symbol had a close. */
  since: number | null;
  beta: number | null;
  volatility: number | null;
  /** 1-day historical value at risk at VAR_CONFIDENCE, as a negative decimal (-0.021 = a 2.1% loss). */
  varRatio: number | null;
  /** The same loss in money at today's value (positive). */
  varAmount: number | null;
  maxDrawdown: DatedDrawdown | null;
  positions: PositionRisk[];
  correlation: CorrelationMatrix;
}

function correlationMatrix(symbols: readonly string[], returns: ReadonlyArray<Series>): CorrelationMatrix {
  const matrix = returns.map((a, i) =>
    returns.map((b, j) => {
      if (i === j) return a.filter(isFiniteNumber).length >= MIN_RETURNS ? 1 : null;
      return correlation(a, b);
    }),
  );
  const pairs: CorrelationPair[] = [];
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const r = matrix[i][j];
      if (r !== null) pairs.push({ a: symbols[i], b: symbols[j], r });
    }
  }
  return {
    symbols: [...symbols],
    matrix,
    high: pairs.filter((p) => p.r >= HIGH_CORRELATION).sort((x, y) => y.r - x.r),
    average: mean(pairs.map((p) => p.r)),
  };
}

/**
 * Risk of the analyzed positions held at today's share counts over the history: beta to the benchmark, annualized
 * volatility, 1-day historical VaR, maximum drawdown, each position's share of risk, and correlations. Every statistic
 * uses the same sessions (those on which every analyzed symbol has a price), so the numbers agree with each other.
 */
export function analyzeRisk(analyzed: readonly ValuedPosition[], history: AlignedCloses | null, benchmark = BENCHMARK): RiskReport {
  const raw = history ?? { dates: [], closes: {} };
  const withHistory = analyzed.filter((p) => (raw.closes[p.symbol] ?? []).some(isPrice));
  const missingHistory = analyzed.filter((p) => !withHistory.includes(p)).map((p) => p.symbol);
  const aligned = lastSessions(onBenchmarkSessions(raw, benchmark), RISK_SESSIONS + 1);
  const dates = [...aligned.dates];
  const shares = Object.fromEntries(withHistory.map((p) => [p.symbol, p.shares]));
  const values = withHistory.length > 0 ? holdingsValueSeries(aligned, shares) : dates.map(() => null);
  const returns = dailyReturns(values);
  const valid = returns.map((r) => r !== null);
  const masked = (series: Series) => series.map((v, i) => (valid[i] ? v : null));

  const benchCloses = aligned.closes[benchmark] ?? dates.map(() => null);
  const benchmarkSeries = benchCloses.map((c) => (isPrice(c) ? c : null));
  const benchReturns = dailyReturns(benchmarkSeries);
  const symbolReturns = withHistory.map((p) => masked(dailyReturns(aligned.closes[p.symbol] ?? [])));

  const value = withHistory.reduce((sum, p) => sum + p.value, 0);
  const weights = withHistory.map((p) => (value > 0 ? p.value / value : 0));
  const shareOfRisk = withHistory.length > 0 ? riskContributions(weights, covarianceMatrix(symbolReturns)) : null;
  const positions: PositionRisk[] = withHistory.map((p, i) => ({
    symbol: p.symbol,
    value: p.value,
    weight: weights[i],
    riskShare: shareOfRisk?.[i] ?? null,
    beta: beta(symbolReturns[i], benchReturns),
    volatility: annualizedVolatility(symbolReturns[i]),
  }));

  const varRatio = historicalVar(returns, VAR_CONFIDENCE);
  const drawdown = maxDrawdown(values);
  const first = values.findIndex(isPrice);
  return {
    symbols: withHistory.map((p) => p.symbol),
    missingHistory,
    value,
    dates,
    values,
    benchmark: benchmarkSeries,
    returns,
    sessions: returns.filter(isFiniteNumber).length,
    since: first >= 0 ? dates[first] : null,
    beta: beta(returns, benchReturns),
    volatility: annualizedVolatility(returns),
    varRatio,
    varAmount: varRatio === null ? null : Math.max(0, -varRatio) * value,
    maxDrawdown: drawdown ? { ...drawdown, peakDate: dates[drawdown.peakIndex], troughDate: dates[drawdown.troughIndex] } : null,
    positions,
    correlation: correlationMatrix(
      withHistory.map((p) => p.symbol),
      symbolReturns,
    ),
  };
}

/** The position whose share of risk exceeds its share of value the most (for "MSFT 20% of value, 31% of risk"). */
export function largestRiskGap(positions: readonly PositionRisk[]): PositionRisk | null {
  let best: PositionRisk | null = null;
  for (const p of positions) {
    if (p.riskShare === null) continue;
    if (!best || p.riskShare - p.weight > (best.riskShare as number) - best.weight) best = p;
  }
  return best && (best.riskShare as number) > best.weight ? best : null;
}

// ---------------------------------------------------------------------------
// "If you had held today's positions"
// ---------------------------------------------------------------------------

/** Sessions per range of the performance chart. */
export const PERFORMANCE_SESSIONS = { "3m": 63, "6m": 126, "1y": 252 } as const;
export type PerformanceRange = keyof typeof PERFORMANCE_SESSIONS;

export interface PerformanceSeries {
  dates: number[];
  /** Today's holdings rebased to 100 at the start of the window. */
  holdings: Array<number | null>;
  /** The benchmark rebased to 100 on the same session; all null without one. */
  benchmark: Array<number | null>;
  holdingsReturn: number | null;
  benchmarkReturn: number | null;
  /** Decline of the holdings from their running peak within the window (0 at highs, negative below). */
  drawdown: Array<number | null>;
  maxDrawdown: DatedDrawdown | null;
}

/**
 * The last `sessions` sessions of today's holdings against a benchmark, both rebased to 100 on the first session where
 * both have a value. Hypothetical: today's share counts held throughout, not the investor's actual return.
 */
export function performanceWindow(dates: readonly number[], values: Series, benchmark: Series, sessions: number): PerformanceSeries {
  const n = dates.length;
  const hasBenchmark = benchmark.some(isPrice);
  let start = Math.max(0, n - 1 - sessions);
  while (start < n && !(isPrice(values[start]) && (!hasBenchmark || isPrice(benchmark[start])))) start++;
  const windowDates = dates.slice(start);
  const own = values.slice(start);
  const bench = hasBenchmark ? benchmark.slice(start) : windowDates.map(() => null);
  const drawdown = maxDrawdown(own);
  return {
    dates: windowDates,
    holdings: rebase(own),
    benchmark: hasBenchmark ? rebase(bench) : bench,
    holdingsReturn: periodReturn(own),
    benchmarkReturn: hasBenchmark ? periodReturn(bench) : null,
    drawdown: drawdownSeries(own),
    maxDrawdown: drawdown ? { ...drawdown, peakDate: windowDates[drawdown.peakIndex], troughDate: windowDates[drawdown.troughIndex] } : null,
  };
}

// ---------------------------------------------------------------------------
// Exposure
// ---------------------------------------------------------------------------

export interface ExposureSlice<K> {
  id: string;
  key: K;
  /** Sum of the members' values (or counts, for a count breakdown). */
  value: number;
  /** Share of the total. */
  weight: number;
  symbols: string[];
}

/** Groups items into slices by key, largest first (ties by id), with each slice's share of the total. */
export function groupExposure<T, K>(
  items: readonly T[],
  groupOf: (item: T) => { id: string; key: K },
  valueOf: (item: T) => number,
  symbolOf: (item: T) => string,
): ExposureSlice<K>[] {
  const slices = new Map<string, ExposureSlice<K>>();
  let total = 0;
  for (const item of items) {
    const value = valueOf(item);
    if (!isFiniteNumber(value) || value <= 0) continue;
    const { id, key } = groupOf(item);
    const slice = slices.get(id) ?? { id, key, value: 0, weight: 0, symbols: [] };
    slice.value += value;
    slice.symbols.push(symbolOf(item));
    slices.set(id, slice);
    total += value;
  }
  return [...slices.values()]
    .map((slice) => ({ ...slice, weight: total > 0 ? slice.value / total : 0 }))
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
}

/** Universe sector, asset class or Yahoo sector of a holding (lib/sectors.ts holdingGroup). */
export interface GroupInfo {
  quoteType: string | null;
  /** Yahoo sector name from the profile; only needed for equities outside the stock universe. */
  sector: string | null;
}

/** Exposure by sector or asset class, by value. */
export function sectorExposure(rows: readonly ValuedPosition[], infoOf: (symbol: string) => GroupInfo): ExposureSlice<HoldingGroup>[] {
  return groupExposure(
    rows,
    (row) => {
      const info = infoOf(row.symbol);
      const group = holdingGroup(row.symbol, info.quoteType, info.sector);
      return { id: holdingGroupId(group), key: group };
    },
    (row) => row.value,
    (row) => row.symbol,
  );
}

export type AssetClass = "equity" | "etf" | "fund" | "crypto" | "index" | "future" | "currency" | "other";

const ASSET_CLASSES: Readonly<Record<string, AssetClass>> = {
  EQUITY: "equity",
  ETF: "etf",
  MUTUALFUND: "fund",
  CRYPTOCURRENCY: "crypto",
  INDEX: "index",
  FUTURE: "future",
  CURRENCY: "currency",
};

export function assetClassOf(quoteType: string | null | undefined): AssetClass {
  return (quoteType && ASSET_CLASSES[quoteType.toUpperCase()]) || "other";
}

export function assetClassExposure(rows: readonly ValuedPosition[], quoteTypeOf: (symbol: string) => string | null): ExposureSlice<AssetClass>[] {
  return groupExposure(
    rows,
    (row) => {
      const key = assetClassOf(quoteTypeOf(row.symbol));
      return { id: key, key };
    },
    (row) => row.value,
    (row) => row.symbol,
  );
}

/** The first `max - 1` slices, and the rest folded into one, so a legend stays short; all slices when they fit. */
export function foldSlices<K>(slices: readonly ExposureSlice<K>[], max: number): { shown: ExposureSlice<K>[]; rest: { value: number; weight: number; symbols: string[] } | null } {
  if (slices.length <= max) return { shown: [...slices], rest: null };
  const shown = slices.slice(0, Math.max(0, max - 1));
  const others = slices.slice(shown.length);
  return {
    shown,
    rest: {
      value: others.reduce((sum, s) => sum + s.value, 0),
      weight: others.reduce((sum, s) => sum + s.weight, 0),
      symbols: others.flatMap((s) => s.symbols),
    },
  };
}

// ---------------------------------------------------------------------------
// Currencies
// ---------------------------------------------------------------------------

/** Quote currencies Yahoo reports in minor units (pence, agorot, cents). */
const MINOR_UNITS: Readonly<Record<string, { major: string; factor: number }>> = {
  GBp: { major: "GBP", factor: 100 },
  GBX: { major: "GBP", factor: 100 },
  ILA: { major: "ILS", factor: 100 },
  ZAc: { major: "ZAR", factor: 100 },
};

/** The major currency of a quote currency and how many quote units make one major unit ("GBp" -> GBP, 100). */
export function currencyUnit(code: string): { major: string; factor: number } {
  return MINOR_UNITS[code] ?? { major: code.toUpperCase(), factor: 1 };
}

/** Yahoo FX symbol that converts `from` into `to` (e.g. "JPYUSD=X"); null when both are the same major currency. */
export function fxPairSymbol(from: string, to: string): string | null {
  const a = currencyUnit(from).major;
  const b = currencyUnit(to).major;
  return a === b ? null : `${a}${b}=X`;
}

/** Yahoo FX symbols that convert positions in other currencies into the base currency: unique and sorted. */
export function fxSymbolsFor(positions: ReadonlyArray<{ currency: string }>, base: string): string[] {
  const pairs = positions.map((p) => fxPairSymbol(p.currency, base)).filter((s): s is string => s !== null);
  return [...new Set(pairs)].sort();
}

export interface CurrencySlice {
  /** Quote currency as Yahoo reports it. */
  currency: string;
  /** Value in that currency (not converted). */
  localValue: number;
  symbols: string[];
  /** Value in the base currency at the latest FX rate; null when no rate is available. */
  value: number | null;
  /** Share of the converted total; null when not converted. */
  weight: number | null;
}

export interface CurrencyExposure {
  base: string;
  /** Largest converted value first; currencies without a rate last. */
  slices: CurrencySlice[];
  /** Sum of the converted values. */
  total: number;
  /** Currencies left unconverted for lack of a rate. */
  unconverted: string[];
}

/**
 * Value by quote currency. Other currencies are converted into the base currency at the latest FX rate for this
 * breakdown only (lib/portfolio.ts never converts the totals); currencies without a rate stay unconverted.
 */
export function currencyExposure(positions: readonly ValuedPosition[], base: string, rateOf: (pair: string) => number | null): CurrencyExposure {
  const local = new Map<string, { value: number; symbols: string[] }>();
  for (const p of positions) {
    const entry = local.get(p.currency) ?? { value: 0, symbols: [] };
    entry.value += p.value;
    entry.symbols.push(p.symbol);
    local.set(p.currency, entry);
  }
  const baseUnit = currencyUnit(base);
  const slices: CurrencySlice[] = [...local.entries()].map(([currency, { value, symbols }]) => {
    const unit = currencyUnit(currency);
    const pair = fxPairSymbol(currency, base);
    const rate = pair === null ? 1 : rateOf(pair);
    const converted = isFiniteNumber(rate) && rate > 0 ? (value / unit.factor) * rate * baseUnit.factor : null;
    return { currency, localValue: value, symbols, value: converted, weight: null };
  });
  const total = slices.reduce((sum, s) => sum + (s.value ?? 0), 0);
  for (const slice of slices) slice.weight = slice.value !== null && total > 0 ? slice.value / total : null;
  slices.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.currency.localeCompare(b.currency));
  return { base, slices, total, unconverted: slices.filter((s) => s.value === null).map((s) => s.currency) };
}

// ---------------------------------------------------------------------------
// Income and concentration
// ---------------------------------------------------------------------------

export interface ProjectedDividends {
  /** Sum of shares x forward annual dividend per share, in the base currency. Approximate. */
  amount: number;
  /** Positions with a dividend rate above zero. */
  payers: number;
  positions: number;
  /** amount over the value of all the positions. */
  yield: number | null;
}

/** Approximate annual dividends of the base-currency positions from each quote's forward annual rate. */
export function projectedDividends(rows: readonly ValuedPosition[], rateOf: (symbol: string) => number | null): ProjectedDividends {
  let amount = 0;
  let payers = 0;
  let value = 0;
  for (const row of rows) {
    value += row.value;
    const rate = rateOf(row.symbol);
    if (!isFiniteNumber(rate) || rate <= 0) continue;
    amount += row.shares * rate;
    payers++;
  }
  return { amount, payers, positions: rows.length, yield: value > 0 ? amount / value : null };
}

/** How many equal positions would be as concentrated as these (1 / sum of squared weights by value). */
export function effectivePositionCount(rows: readonly ValuedPosition[]): number | null {
  return rows.length > 0 ? effectivePositions(rows.map((row) => row.value)) : null;
}
