// The factor study and the risk calibration behind lib/factor-research.json and lib/risk-calibration.json: the pure
// core of scripts/research-factors.ts, which only loads bars, renders docs/factor-research.md and writes the files.
//
// Seven factors were fixed before any result was seen: the five style factors of lib/factors.ts in their literature
// direction, the technical score and an equal-weight composite of the style factors' z-scores. Each is tested against
// same-day excess returns (non-overlapping dates with Holm and Benjamini-Hochberg adjustment, all dates with a
// Newey-West t, subperiod signs, sector-neutral, beta-adjusted and ex-winners ICs, quintile spreads, turnover and
// power). The risk part measures the volatility forecast of lib/risk-forecast.ts with the same functions the app uses.
// Nothing here reads the clock, the network or the file system, so the same bars and settings always give the same
// results (lib/research.test.ts checks this).

import type { DailyBar } from "@/lib/bars";

import {
  benchmarkGap,
  cleanDailyBars,
  cutBars,
  isoToTime,
  RESEARCH_FACTORS,
  timeToIso,
  type BandCoverage,
  type DateRange,
  type FactorHorizonResult,
  type FactorResearch,
  type QuintileRow,
  type ResearchFactor,
  type RiskCalibration,
} from "./evaluation";
import { crossSectionalZ, FACTOR_DIRECTION, FACTOR_KEYS, styleFactorSeries, type StyleFactorKey } from "./factors";
import {
  benjaminiHochberg,
  holm,
  minimumDetectableIc,
  neweyWest,
  pearson,
  quantile,
  quintileOf,
  quintileSort,
  ranks,
  spearman,
  studentTPValue,
  tTest,
  turnover,
} from "./research-stats";
import { drawdownWithin, forecastDailyVolatility, logReturns, qlike, RISK_SETTINGS, shortWindowDailyVolatility } from "./risk-forecast";
import { MODEL_VERSION, technicalScoreSeries } from "./signal";
import { median } from "./stats";

// ---------------------------------------------------------------------------
// Settings (the "factors" and "risk" sections of scripts/evaluation.config.json)
// ---------------------------------------------------------------------------

export interface FactorStudySettings {
  window: DateRange;
  /** Holding periods in sessions. */
  horizons: number[];
  /** A date enters the statistics only with at least this many stocks. */
  minStocksPerDate: number;
  alpha: number;
  /** How many of the biggest ex-post winners the robustness IC leaves out. */
  excludeWinners: number;
  subperiods: DateRange[];
}

export interface RiskStudySettings {
  window: DateRange;
  bandHorizon: number;
  persistenceHorizon: number;
  drawdownHorizon: number;
  /** Negative decimal, e.g. -0.1 for a 10% drop. */
  drawdownThreshold: number;
  subperiods: DateRange[];
}

export interface ResearchInput {
  /** Completed daily bars per symbol: the universe stocks and both benchmarks (any order; cleaned here). */
  bars: Readonly<Record<string, readonly DailyBar[]>>;
  /** Universe stocks in a fixed order; stocks without bars are left out. */
  symbols: readonly string[];
  /** Sector of each stock for the sector-neutral IC; a stock without one counts as "other". */
  sectors: ReadonlyMap<string, string>;
  /** SPY (calendar, beta, hindsight gap) and RSP (hindsight gap). */
  benchmarks: { market: string; equalWeight: string };
  factors: FactorStudySettings;
  risk: RiskStudySettings;
}

// ---------------------------------------------------------------------------
// Factors
// ---------------------------------------------------------------------------

/** How each factor is described in lib/factor-research.json. */
export const FACTOR_LABEL: Readonly<Record<ResearchFactor, string>> = {
  momentum: "12-1 momentum",
  reversal: "Short-term reversal (minus the 21-session return)",
  high52: "52-week high (close over the 252-session high)",
  volatility: "Low volatility (minus the 63-session volatility)",
  beta: "Low beta (minus the 252-session beta to SPY)",
  technical: `Technical score (model v${MODEL_VERSION})`,
  composite: "Composite (equal-weight z-scores of the five style factors)",
};

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/** The universe on the market's calendar: prices, factor values and risk measures per stock and session. */
export interface Panel {
  symbols: string[];
  sectors: string[];
  /** Calendar: the market's sessions up to the window end. */
  T: number[];
  /** Adjusted close and open per stock on the calendar (NaN where the stock has no bar). */
  C: number[][];
  O: number[][];
  /** The market's adjusted close and open. */
  M: number[];
  MO: number[];
  /** Factor values in their literature direction, per factor, stock and session. */
  F: Record<ResearchFactor, number[][]>;
  /** Raw 252-session beta and 63-session annualized volatility. */
  beta: number[][];
  vol63: number[][];
  /** First calendar index on or after the window start. */
  k0: number;
  bars: DailyBar[][];
  market: DailyBar[];
}

function adjusted(bar: DailyBar): number {
  return bar.adjClose > 0 ? bar.adjClose : bar.c;
}

function adjustedOpen(bar: DailyBar): number {
  return bar.o > 0 ? bar.o * (adjusted(bar) / bar.c) : Number.NaN;
}

function finite(x: number | null | undefined): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

export interface PanelOptions {
  symbols: readonly string[];
  sectors: ReadonlyMap<string, string>;
  market: string;
  window: DateRange;
  /** The composite needs at least this many stocks with all five style factors on a date. */
  minStocks: number;
}

/**
 * Aligns the stocks with bars to the market's sessions up to the window end and computes every factor from data up
 * to each session (no look-ahead). Throws without market bars or with less than 252 sessions before the window start.
 */
export function buildPanel(barsBySymbol: Readonly<Record<string, readonly DailyBar[]>>, options: PanelOptions): Panel {
  const { market: marketSymbol, window, minStocks } = options;
  const market = cutBars(cleanDailyBars(barsBySymbol[marketSymbol] ?? []), window.to);
  if (market.length === 0) throw new Error(`No bars for the market benchmark ${marketSymbol}.`);
  const T = market.map((bar) => bar.t);
  const N = T.length;
  const kOf = new Map(T.map((t, k) => [t, k] as const));
  const marketDated = market.map((bar) => ({ t: bar.t, c: adjusted(bar) }));
  const nan = () => new Array<number>(N).fill(Number.NaN);

  const symbols = options.symbols.filter((symbol) => (barsBySymbol[symbol] ?? []).length > 0);
  const F = Object.fromEntries(RESEARCH_FACTORS.map((key) => [key, symbols.map(nan)])) as Record<ResearchFactor, number[][]>;
  const C: number[][] = [];
  const O: number[][] = [];
  const beta: number[][] = [];
  const vol63: number[][] = [];
  const bars: DailyBar[][] = [];

  symbols.forEach((symbol, s) => {
    const series = cutBars(cleanDailyBars(barsBySymbol[symbol] ?? []), window.to);
    bars.push(series);
    const c = nan();
    const o = nan();
    const b = nan();
    const v = nan();
    const values = styleFactorSeries(
      series.map((bar) => ({ t: bar.t, c: adjusted(bar) })),
      marketDated,
    );
    series.forEach((bar, i) => {
      const k = kOf.get(bar.t);
      if (k === undefined) return;
      c[k] = adjusted(bar);
      o[k] = adjustedOpen(bar);
      for (const key of FACTOR_KEYS) {
        const raw = values[i][key];
        if (finite(raw)) F[key][s][k] = FACTOR_DIRECTION[key] * raw;
      }
      if (finite(values[i].beta)) b[k] = values[i].beta as number;
      if (finite(values[i].volatility)) v[k] = values[i].volatility as number;
    });
    for (const point of technicalScoreSeries(series)) {
      const k = kOf.get(point.t);
      if (k !== undefined && point.score !== null) F.technical[s][k] = point.score;
    }
    C.push(c);
    O.push(o);
    beta.push(b);
    vol63.push(v);
  });

  // The composite: equal-weight mean of the five style factors' z-scores, for stocks that have all five.
  for (let k = 0; k < N; k++) {
    const members = symbols.map((_, s) => s).filter((s) => FACTOR_KEYS.every((key) => finite(F[key][s][k])));
    if (members.length < minStocks) continue;
    const sum = new Map<number, number>(members.map((s) => [s, 0]));
    for (const key of FACTOR_KEYS) {
      const z = crossSectionalZ(new Map(members.map((s) => [String(s), F[key][s][k]] as const)));
      for (const s of members) sum.set(s, (sum.get(s) as number) + (z.get(String(s)) ?? Number.NaN) / FACTOR_KEYS.length);
    }
    for (const s of members) F.composite[s][k] = sum.get(s) as number;
  }

  const k0 = T.findIndex((t) => t >= isoToTime(window.from));
  if (k0 < 252) throw new Error(`Not enough history before ${window.from} for the 252-session factors.`);
  return {
    symbols,
    sectors: symbols.map((symbol) => options.sectors.get(symbol) ?? "other"),
    T,
    C,
    O,
    M: market.map(adjusted),
    MO: market.map(adjustedOpen),
    F,
    beta,
    vol63,
    k0,
    bars,
    market,
  };
}

// ---------------------------------------------------------------------------
// Cross-sectional tests
// ---------------------------------------------------------------------------

export interface ForwardReturns {
  /** Forward return per stock and signal session: next adjusted open to the adjusted close h sessions later. */
  R: number[][];
  /** Same-day mean over the stocks with a forward return (NaN below the minimum). */
  mean: number[];
}

/**
 * Forward returns over h sessions for every stock and signal session, optionally transformed by `adjust`, with the
 * same-day mean where at least `minStocks` stocks have one.
 */
export function forwardReturns(
  panel: Pick<Panel, "T" | "symbols" | "O" | "C">,
  h: number,
  minStocks: number,
  adjust?: (s: number, k: number, r: number) => number,
): ForwardReturns {
  const N = panel.T.length;
  const R = panel.symbols.map(() => new Array<number>(N).fill(Number.NaN));
  const mean = new Array<number>(N).fill(Number.NaN);
  for (let k = 0; k + h < N; k++) {
    let sum = 0;
    let n = 0;
    panel.symbols.forEach((_, s) => {
      const entry = panel.O[s][k + 1];
      const exit = panel.C[s][k + h];
      if (!(entry > 0) || !(exit > 0)) return;
      const r = adjust ? adjust(s, k, exit / entry - 1) : exit / entry - 1;
      if (!Number.isFinite(r)) return;
      R[s][k] = r;
      sum += r;
      n += 1;
    });
    if (n >= minStocks) mean[k] = sum / n;
  }
  return { R, mean };
}

/** Forward returns net of the stock's trailing beta times SPY's return over the same span (open of k + 1 to close of k + h). */
export function betaAdjustedReturns(panel: Panel, h: number, minStocks: number): ForwardReturns {
  return forwardReturns(panel, h, minStocks, (s, k, r) => {
    const b = panel.beta[s][k];
    const market = panel.M[k + h] / panel.MO[k + 1] - 1;
    return Number.isFinite(b) && Number.isFinite(market) ? r - b * market : Number.NaN;
  });
}

export interface DateResult {
  k: number;
  ic: number;
  spread: number;
  top: number[];
  sectorIc: number | null;
}

/**
 * One signal date: the Spearman IC of the factor with same-day excess returns, the quintile spread, the top quintile
 * (for turnover) and the sector-neutral IC. Null below `minStocks` stocks or without a same-day mean.
 */
export function evaluateDate(
  panel: Pick<Panel, "symbols" | "sectors">,
  values: number[][],
  returns: ForwardReturns,
  k: number,
  minStocks: number,
  exclude?: ReadonlySet<number>,
): DateResult | null {
  const m = returns.mean[k];
  if (!Number.isFinite(m)) return null;
  const idx: number[] = [];
  panel.symbols.forEach((_, s) => {
    if (!exclude?.has(s) && Number.isFinite(values[s][k]) && Number.isFinite(returns.R[s][k])) idx.push(s);
  });
  if (idx.length < minStocks) return null;
  const x = idx.map((s) => values[s][k]);
  const y = idx.map((s) => returns.R[s][k] - m);
  const ic = spearman(x, y);
  const sort = quintileSort(x, y);
  if (ic === null || sort === null) return null;

  // Sector-neutral IC: both rank vectors demeaned within each sector.
  const rx = ranks(x);
  const ry = ranks(y);
  const groups = new Map<string, number[]>();
  idx.forEach((s, i) => {
    const list = groups.get(panel.sectors[s]);
    if (list) list.push(i);
    else groups.set(panel.sectors[s], [i]);
  });
  const dx = new Array<number>(idx.length);
  const dy = new Array<number>(idx.length);
  for (const members of groups.values()) {
    const mx = members.reduce((a, i) => a + rx[i], 0) / members.length;
    const my = members.reduce((a, i) => a + ry[i], 0) / members.length;
    for (const i of members) {
      dx[i] = rx[i] - mx;
      dy[i] = ry[i] - my;
    }
  }
  return { k, ic, spread: sort.spread, top: sort.top.map((i) => idx[i]), sectorIc: pearson(dx, dy) };
}

function grid(panel: Panel, h: number): number[] {
  const out: number[] = [];
  for (let k = panel.k0; k + h < panel.T.length; k += h) out.push(k);
  return out;
}

function inRange(panel: Panel, k: number, range: DateRange): boolean {
  return panel.T[k] >= isoToTime(range.from) && panel.T[k] <= isoToTime(range.to);
}

function meanOrNull(xs: readonly number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sign(x: number | null): 1 | -1 | 0 {
  return x === null || x === 0 ? 0 : x > 0 ? 1 : -1;
}

interface Raw {
  key: ResearchFactor;
  days: number;
  rows: DateResult[];
  result: Omit<FactorHorizonResult, "holmP" | "bhQ" | "verdict">;
  sdIc: number | null;
}

function runFactor(
  panel: Panel,
  key: ResearchFactor,
  h: number,
  context: { returns: ForwardReturns; adjusted: ForwardReturns; winners: ReadonlySet<number>; config: FactorStudySettings },
): Raw {
  const { returns, adjusted: betaAdjusted, winners, config } = context;
  const values = panel.F[key];
  const ks = grid(panel, h);
  const rows = ks.map((k) => evaluateDate(panel, values, returns, k, config.minStocksPerDate)).filter((r): r is DateResult => r !== null);
  const ics = rows.map((r) => r.ic);
  const test = tTest(ics);
  const spreads = tTest(rows.map((r) => r.spread));
  const subperiodIc = config.subperiods.map((range) => meanOrNull(rows.filter((r) => inRange(panel, r.k, range)).map((r) => r.ic)));

  const daily: number[] = [];
  for (let k = panel.k0; k + h < panel.T.length; k++) {
    const r = evaluateDate(panel, values, returns, k, config.minStocksPerDate);
    if (r) daily.push(r.ic);
  }
  const nw = neweyWest(daily, h);

  const turnovers: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const t = turnover(new Set(rows[i - 1].top), rows[i].top);
    if (t !== null) turnovers.push(t);
  }
  const robust = (fr: ForwardReturns, exclude?: ReadonlySet<number>) =>
    meanOrNull(ks.map((k) => evaluateDate(panel, values, fr, k, config.minStocksPerDate, exclude)).filter((r): r is DateResult => r !== null).map((r) => r.ic));

  return {
    key,
    days: h,
    rows,
    sdIc: test?.se !== null && test?.se !== undefined ? test.se * Math.sqrt(test.n) : null,
    result: {
      days: h,
      dates: ics.length,
      ic: test?.mean ?? null,
      t: test?.t ?? null,
      p: test?.t !== null && test?.t !== undefined ? studentTPValue(test.t, test.n - 1) : null,
      allDates: { ic: meanOrNull(daily), t: nw?.t ?? null, dates: daily.length },
      subperiodIc,
      signs: subperiodIc.map(sign),
      spread: spreads?.mean ?? null,
      spreadT: spreads?.t ?? null,
      turnover: meanOrNull(turnovers),
      sectorNeutralIc: meanOrNull(rows.map((r) => r.sectorIc).filter(finite)),
      betaAdjustedIc: robust(betaAdjusted),
      exWinnersIc: robust(returns, winners),
    },
  };
}

/** The biggest ex-post winners: annualized return from the window start (or listing) to its end, ties by symbol. */
export function exPostWinners(panel: Pick<Panel, "T" | "C" | "symbols" | "k0">, count: number): Array<{ s: number; symbol: string; annualReturn: number }> {
  const last = panel.T.length - 1;
  return panel.symbols
    .map((symbol, s) => {
      let first = panel.k0;
      while (first < last && !(panel.C[s][first] > 0)) first += 1;
      const years = (panel.T[last] - panel.T[first]) / (365.25 * 86_400_000);
      return { s, symbol, annualReturn: years > 0 ? (panel.C[s][last] / panel.C[s][first]) ** (1 / years) - 1 : Number.NaN };
    })
    .filter((w) => Number.isFinite(w.annualReturn))
    .sort((a, b) => b.annualReturn - a.annualReturn || a.symbol.localeCompare(b.symbol))
    .slice(0, count);
}

/**
 * The pre-registered factor study on a panel: every factor at every horizon, Holm and Benjamini-Hochberg adjustment
 * over all tests, the adoption rule, power, and the bias gauges (universe against its benchmarks, ex-post winners,
 * how much the technical score follows last month's move).
 */
export function researchFactors(
  panel: Panel,
  settings: FactorStudySettings,
  benchmarks: { market: string; equalWeight: string },
  equalWeight: readonly DailyBar[],
): FactorResearch {
  const winners = exPostWinners(panel, settings.excludeWinners);
  const winnerSet = new Set(winners.map((w) => w.s));
  const raws: Raw[] = [];
  for (const h of settings.horizons) {
    const returns = forwardReturns(panel, h, settings.minStocksPerDate);
    const adjusted = betaAdjustedReturns(panel, h, settings.minStocksPerDate);
    for (const key of RESEARCH_FACTORS) raws.push(runFactor(panel, key, h, { returns, adjusted, winners: winnerSet, config: settings }));
  }

  const ps = raws.map((r) => r.result.p ?? 1);
  const holmP = holm(ps);
  const bhQ = benjaminiHochberg(ps);
  const results = raws.map((raw, i): { key: ResearchFactor; result: FactorHorizonResult } => {
    const consistent = raw.result.ic !== null && raw.result.signs.every((s) => s === sign(raw.result.ic));
    const verdict = holmP[i] < settings.alpha && consistent ? "predictive" : "not_predictive";
    return { key: raw.key, result: { ...raw.result, holmP: holmP[i], bhQ: bhQ[i], verdict } };
  });

  const power = settings.horizons.map((h) => {
    const rows = raws.filter((r) => r.days === h);
    const sds = rows.map((r) => r.sdIc).filter(finite);
    const dates = median(rows.map((r) => r.result.dates)) ?? 0;
    const sd = median(sds);
    return { days: h, dates, sdIc: sd, minimumDetectableIc: sd === null ? null : minimumDetectableIc(sd, dates) };
  });

  // How much the technical score is last month's relative move: rank correlation with the 21-session return.
  const month: number[] = [];
  for (let k = panel.k0; k < panel.T.length; k += 5) {
    const idx = panel.symbols.map((_, s) => s).filter((s) => Number.isFinite(panel.F.technical[s][k]) && Number.isFinite(panel.F.reversal[s][k]));
    if (idx.length < settings.minStocksPerDate) continue;
    const corr = spearman(
      idx.map((s) => panel.F.technical[s][k]),
      idx.map((s) => -panel.F.reversal[s][k]),
    );
    if (corr !== null) month.push(corr);
  }

  const lastSignal = Math.max(...raws.flatMap((r) => r.rows.map((row) => row.k)));
  const windows = [settings.window, ...settings.subperiods];
  return {
    window: { ...settings.window },
    from: timeToIso(panel.T[panel.k0]),
    to: timeToIso(panel.T[lastSignal]),
    universe: panel.symbols.length,
    model: MODEL_VERSION,
    rule: `A factor is called predictive only if its Holm-adjusted p over the ${raws.length} pre-registered tests is below ${settings.alpha} and its mean IC has the same sign in every subperiod.`,
    alpha: settings.alpha,
    horizons: [...settings.horizons],
    subperiods: settings.subperiods.map((range) => ({ ...range })),
    factors: RESEARCH_FACTORS.map((key) => ({
      key,
      label: FACTOR_LABEL[key],
      direction: key === "technical" || key === "composite" ? 1 : FACTOR_DIRECTION[key as StyleFactorKey],
      results: results.filter((r) => r.key === key).map((r) => r.result),
    })),
    power,
    bias: {
      benchmarks: { market: benchmarks.market, equalWeight: benchmarks.equalWeight },
      universeVsBenchmarks: windows.map((range) => benchmarkGap(panel.bars, panel.market, cleanDailyBars(equalWeight), range)),
      exWinners: winners.map(({ symbol, annualReturn }) => ({ symbol, annualReturn })),
      technicalVsMonthReturn: meanOrNull(month),
    },
  };
}

// ---------------------------------------------------------------------------
// Risk calibration
// ---------------------------------------------------------------------------

/**
 * Calibration of the volatility forecast on a panel: band coverage overall and by subperiod, QLIKE against the
 * 20-session estimate, persistence of volatility and beta, and how often each volatility quintile fell by the
 * threshold within the horizon. Dates need at least `minStocks` stocks for the cross-sectional parts.
 */
export function calibrateRisk(panel: Panel, settings: RiskStudySettings, minStocks: number): RiskCalibration {
  const N = panel.T.length;
  const from = panel.T.findIndex((t) => t >= isoToTime(settings.window.from));
  const H = settings.bandHorizon;
  const zero = () => ({ n: 0, in1: 0, in2: 0 });
  const blend = { all: zero(), short: zero(), periods: settings.subperiods.map(zero) };
  const losses = { n: 0, blend: 0, short: 0 };

  panel.symbols.forEach((_, s) => {
    const closes = panel.C[s];
    const returns = logReturns(closes);
    for (let k = from; k + H < N; k++) {
      const sigma = forecastDailyVolatility(returns, k);
      const move = Math.log(closes[k + H] / closes[k]);
      if (sigma === null || !Number.isFinite(move)) continue;
      const band = sigma * Math.sqrt(H);
      const tally = (counter: { n: number; in1: number; in2: number }, width: number) => {
        counter.n += 1;
        if (Math.abs(move) <= width) counter.in1 += 1;
        if (Math.abs(move) <= 2 * width) counter.in2 += 1;
      };
      tally(blend.all, band);
      settings.subperiods.forEach((range, p) => {
        if (inRange(panel, k, range)) tally(blend.periods[p], band);
      });
      const short = shortWindowDailyVolatility(returns, k);
      if (short !== null) tally(blend.short, short * Math.sqrt(H));
      let realized = 0;
      for (let j = k + 1; j <= k + H; j++) realized += returns[j] ** 2;
      const lossBlend = qlike(realized, H * sigma ** 2);
      const lossShort = short === null ? null : qlike(realized, H * short ** 2);
      if (lossBlend !== null && lossShort !== null) {
        losses.n += 1;
        losses.blend += lossBlend;
        losses.short += lossShort;
      }
    }
  });
  const coverage = (c: { n: number; in1: number; in2: number }): BandCoverage => ({ n: c.n, within1: c.n ? c.in1 / c.n : null, within2: c.n ? c.in2 / c.n : null });

  // Persistence: trailing 63-session volatility and 252-session beta against the next 63 sessions.
  const P = settings.persistenceHorizon;
  const volCorr: number[] = [];
  const betaCorr: number[] = [];
  for (let k = from; k + P < N; k += P) {
    const tv: number[] = [];
    const fv: number[] = [];
    const tb: number[] = [];
    const fb: number[] = [];
    panel.symbols.forEach((_, s) => {
      if (!Number.isFinite(panel.vol63[s][k]) || !Number.isFinite(panel.beta[s][k])) return;
      const r: number[] = [];
      const m: number[] = [];
      for (let j = k + 1; j <= k + P; j++) {
        const rs = panel.C[s][j] / panel.C[s][j - 1] - 1;
        const rm = panel.M[j] / panel.M[j - 1] - 1;
        if (!Number.isFinite(rs) || !Number.isFinite(rm)) return;
        r.push(rs);
        m.push(rm);
      }
      const test = tTest(r);
      const mr = r.reduce((a, b) => a + b, 0) / r.length;
      const mm = m.reduce((a, b) => a + b, 0) / m.length;
      let cov = 0;
      let varM = 0;
      for (let i = 0; i < r.length; i++) {
        cov += (r[i] - mr) * (m[i] - mm);
        varM += (m[i] - mm) ** 2;
      }
      if (test?.se === null || test === null || !(varM > 0)) return;
      tv.push(panel.vol63[s][k]);
      fv.push(test.se * Math.sqrt(test.n));
      tb.push(panel.beta[s][k]);
      fb.push(cov / varM);
    });
    if (tv.length < minStocks) continue;
    const v = spearman(tv, fv);
    const b = spearman(tb, fb);
    if (v !== null) volCorr.push(v);
    if (b !== null) betaCorr.push(b);
  }
  const persistence = (xs: number[]) => ({ mean: meanOrNull(xs), min: xs.length ? Math.min(...xs) : null, t: tTest(xs)?.t ?? null });

  // Volatility quintiles: how bad a normal month was, by trailing 63-session volatility.
  const D = settings.drawdownHorizon;
  const threshold = settings.drawdownThreshold;
  const make = () => Array.from({ length: 5 }, () => ({ n: 0, drawdown: 0, loss: 0, vols: [] as number[] }));
  const overall = make();
  const periods = settings.subperiods.map(make);
  const breakpoints: number[][] = [];
  for (let k = from; k + D < N; k += D) {
    const members = panel.symbols
      .map((_, s) => s)
      .filter((s) => Number.isFinite(panel.vol63[s][k]) && drawdownWithin(panel.C[s], k, D) !== null)
      .sort((a, b) => panel.vol63[a][k] - panel.vol63[b][k] || a - b);
    if (members.length < minStocks) continue;
    const vols = members.map((s) => panel.vol63[s][k]);
    const cuts = [1, 2, 3, 4].map((j) => quantile(vols, j / 5) as number);
    breakpoints.push(cuts);
    members.forEach((s, position) => {
      const q = quintileOf(position, members.length);
      const dd = drawdownWithin(panel.C[s], k, D) as number;
      const ret = panel.C[s][k + D] / panel.C[s][k] - 1;
      const buckets = [overall[q], ...settings.subperiods.flatMap((range, p) => (inRange(panel, k, range) ? [periods[p][q]] : []))];
      for (const bucket of buckets) {
        bucket.n += 1;
        if (dd <= threshold) bucket.drawdown += 1;
        if (ret <= threshold) bucket.loss += 1;
        bucket.vols.push(panel.vol63[s][k]);
      }
    });
  }
  // Today's boundaries, for placing a stock in the current cross-section (no outcome is needed for them).
  const endVols = panel.symbols.map((_, s) => panel.vol63[s][N - 1]).filter(Number.isFinite);
  const latest = endVols.length >= minStocks ? { date: timeToIso(panel.T[N - 1]), values: [1, 2, 3, 4].map((j) => quantile(endVols, j / 5) as number) } : null;
  const rows = (buckets: ReturnType<typeof make>): QuintileRow[] =>
    buckets.map((b, q) => ({ quintile: q + 1, n: b.n, medianVolatility: median(b.vols), drawdown: b.n ? b.drawdown / b.n : null, loss: b.n ? b.loss / b.n : null }));

  return {
    window: { ...settings.window },
    subperiods: settings.subperiods.map((range) => ({ ...range })),
    estimator: { shortWindow: RISK_SETTINGS.shortWindow, longWindow: RISK_SETTINGS.longWindow, shortWeight: RISK_SETTINGS.shortWeight },
    bands: {
      horizon: H,
      overall: coverage(blend.all),
      shortWindowOnly: coverage(blend.short),
      subperiods: settings.subperiods.map((range, p) => ({ ...range, ...coverage(blend.periods[p]) })),
    },
    qlike: { n: losses.n, blend: losses.n ? losses.blend / losses.n : null, shortWindowOnly: losses.n ? losses.short / losses.n : null },
    persistence: { horizon: P, dates: volCorr.length, volatility: persistence(volCorr), beta: persistence(betaCorr) },
    quintiles: {
      horizon: D,
      threshold,
      measure: "annualized volatility of the last 63 daily returns (lib/factors.ts)",
      breakpoints: { median: [0, 1, 2, 3].map((j) => median(breakpoints.map((cuts) => cuts[j])) as number), latest },
      overall: rows(overall),
      subperiods: settings.subperiods.map((range, p) => ({ ...range, rows: rows(periods[p]) })),
    },
  };
}

// ---------------------------------------------------------------------------
// Both studies
// ---------------------------------------------------------------------------

/** Runs the factor study and the risk calibration; the risk part reuses the factor panel when both windows end together. */
export function runResearch(input: ResearchInput): { research: FactorResearch; risk: RiskCalibration } {
  const { bars, benchmarks, factors, risk } = input;
  const options = { symbols: input.symbols, sectors: input.sectors, market: benchmarks.market, minStocks: factors.minStocksPerDate };
  const panel = buildPanel(bars, { ...options, window: factors.window });
  const research = researchFactors(panel, factors, benchmarks, bars[benchmarks.equalWeight] ?? []);
  const riskPanel = risk.window.to === factors.window.to ? panel : buildPanel(bars, { ...options, window: risk.window });
  return { research, risk: calibrateRisk(riskPanel, risk, factors.minStocksPerDate) };
}
