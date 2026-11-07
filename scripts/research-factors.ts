/**
 * Pre-registered factor research on the InvestSeek universe (npm run research).
 *
 * The factor study of the v0.3 audit, ported into the repository on the shared definitions: seven factors fixed before
 * any result was seen, namely the five style factors of lib/factors.ts in their literature direction (12-1 momentum,
 * short-term reversal, 52-week high, low volatility, low beta), the app's technical score and an equal-weight
 * composite of the five style factors' cross-sectional z-scores. Each is tested at 5, 21 and 63 sessions against
 * same-day excess returns: mean Spearman IC on non-overlapping dates (the pre-registered test, with Holm and
 * Benjamini-Hochberg adjustment over all 21 tests) and on all dates with a Newey-West t, the sign in each subperiod,
 * sector-neutral and beta-adjusted ICs, the IC without the biggest ex-post winners, quintile spreads, top-quintile
 * turnover, the minimum detectable IC, and the universe against RSP and SPY as a gauge of hindsight in its selection.
 *
 * The adoption rule is stated in every output: a factor is called predictive only if its Holm-adjusted p is below
 * the configured alpha (0.05) and its mean IC has the same sign in every subperiod.
 *
 * It also measures what the data does forecast, risk: the calibration of the volatility forecast in
 * lib/risk-forecast.ts (band coverage and QLIKE), the persistence of volatility and beta, and how often each
 * volatility quintile fell 10% or more within a month.
 *
 * Outputs: lib/factor-research.json and lib/risk-calibration.json (compact, for the app and the AI) and
 * docs/factor-research.md. Bars come from the same cache as npm run evaluate, so --offline needs no network.
 *
 * Usage: npm run research -- [--offline] [--cache <dir>] [--config scripts/evaluation.config.json]
 *                            [--out docs/factor-research.md] [--factors lib/factor-research.json] [--risk lib/risk-calibration.json]
 */

import { writeFileSync } from "node:fs";

import type { DailyBar } from "../lib/bars";
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
} from "../lib/evaluation";
import { crossSectionalZ, FACTOR_DIRECTION, FACTOR_KEYS, styleFactorSeries, type StyleFactorKey } from "../lib/factors";
import { benjaminiHochberg, holm, minimumDetectableIc, neweyWest, pearson, quantile, quintileSort, ranks, spearman, studentTPValue, tTest, turnover } from "../lib/research-stats";
import { drawdownWithin, forecastDailyVolatility, logReturns, qlike, RISK_SETTINGS, shortWindowDailyVolatility } from "../lib/risk-forecast";
import { MODEL_VERSION, technicalScoreSeries } from "../lib/signal";
import { median } from "../lib/stats";
import { SECTORS, UNIVERSE_STOCKS } from "../lib/universe";

import { DEFAULT_CACHE_DIR, DEFAULT_CONFIG_PATH, loadBars, readConfig, roundReplacer, type ScriptConfig } from "./evaluate-signal";

// ---------------------------------------------------------------------------
// Factors
// ---------------------------------------------------------------------------

const FACTOR_LABEL: Record<ResearchFactor, string> = {
  momentum: "12-1 momentum",
  reversal: "Short-term reversal (minus the 21-session return)",
  high52: "52-week high (close over the 252-session high)",
  volatility: "Low volatility (minus the 63-session volatility)",
  beta: "Low beta (minus the 252-session beta to SPY)",
  technical: `Technical score (model v${MODEL_VERSION})`,
  composite: "Composite (equal-weight z-scores of the five style factors)",
};

const SHORT_LABEL: Record<ResearchFactor, string> = {
  momentum: "12-1 momentum",
  reversal: "Reversal",
  high52: "52-week high",
  volatility: "Low volatility",
  beta: "Low beta",
  technical: "Technical score",
  composite: "Composite",
};

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

interface Panel {
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

function buildPanel(barsBySymbol: Record<string, DailyBar[]>, marketSymbol: string, window: DateRange, minStocks: number): Panel {
  const sectorOf = new Map(SECTORS.flatMap((sector) => sector.stocks.map((symbol) => [symbol, sector.key] as const)));
  const market = cutBars(cleanDailyBars(barsBySymbol[marketSymbol] ?? []), window.to);
  if (market.length === 0) throw new Error(`No bars for the market benchmark ${marketSymbol}.`);
  const T = market.map((bar) => bar.t);
  const N = T.length;
  const kOf = new Map(T.map((t, k) => [t, k] as const));
  const marketDated = market.map((bar) => ({ t: bar.t, c: adjusted(bar) }));
  const nan = () => new Array<number>(N).fill(Number.NaN);

  const symbols = UNIVERSE_STOCKS.filter((symbol) => (barsBySymbol[symbol] ?? []).length > 0);
  const F = Object.fromEntries(RESEARCH_FACTORS.map((key) => [key, symbols.map(nan)])) as Record<ResearchFactor, number[][]>;
  const C: number[][] = [];
  const O: number[][] = [];
  const beta: number[][] = [];
  const vol63: number[][] = [];
  const bars: DailyBar[][] = [];

  symbols.forEach((symbol, s) => {
    const series = cutBars(cleanDailyBars(barsBySymbol[symbol]), window.to);
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
    sectors: symbols.map((symbol) => sectorOf.get(symbol) ?? "other"),
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

interface ForwardReturns {
  /** Forward return per stock and signal session: next adjusted open to the adjusted close h sessions later. */
  R: number[][];
  /** Same-day mean over the stocks with a forward return (NaN below the minimum). */
  mean: number[];
}

function forwardReturns(panel: Panel, h: number, minStocks: number, adjust?: (s: number, k: number, r: number) => number): ForwardReturns {
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

interface DateResult {
  k: number;
  ic: number;
  spread: number;
  top: number[];
  sectorIc: number | null;
}

function evaluateDate(panel: Panel, values: number[][], returns: ForwardReturns, k: number, minStocks: number, exclude?: ReadonlySet<number>): DateResult | null {
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

function runFactor(panel: Panel, key: ResearchFactor, h: number, context: { returns: ForwardReturns; adjusted: ForwardReturns; winners: ReadonlySet<number>; config: ScriptConfig["factors"] }): Raw {
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

/** The biggest ex-post winners: annualized return from the window start (or listing) to its end. */
function exPostWinners(panel: Panel, count: number): Array<{ s: number; symbol: string; annualReturn: number }> {
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

function researchFactors(panel: Panel, config: ScriptConfig, equalWeight: DailyBar[]): FactorResearch {
  const settings = config.factors;
  const winners = exPostWinners(panel, settings.excludeWinners);
  const winnerSet = new Set(winners.map((w) => w.s));
  const raws: Raw[] = [];
  for (const h of settings.horizons) {
    const returns = forwardReturns(panel, h, settings.minStocksPerDate);
    // Beta-adjusted: each forward return net of the stock's trailing beta times SPY's return over the same span.
    const adjusted = forwardReturns(panel, h, settings.minStocksPerDate, (s, k, r) => {
      const b = panel.beta[s][k];
      const market = panel.M[k + h] / panel.MO[k + 1] - 1;
      return Number.isFinite(b) && Number.isFinite(market) ? r - b * market : Number.NaN;
    });
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
      benchmarks: { market: config.data.market, equalWeight: config.data.equalWeight },
      universeVsBenchmarks: windows.map((range) => benchmarkGap(panel.bars, panel.market, cleanDailyBars(equalWeight), range)),
      exWinners: winners.map(({ symbol, annualReturn }) => ({ symbol, annualReturn })),
      technicalVsMonthReturn: meanOrNull(month),
    },
  };
}

// ---------------------------------------------------------------------------
// Risk calibration
// ---------------------------------------------------------------------------

function calibrateRisk(panel: Panel, config: ScriptConfig): RiskCalibration {
  const settings = config.risk;
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
    if (tv.length < config.factors.minStocksPerDate) continue;
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
    if (members.length < config.factors.minStocksPerDate) continue;
    const vols = members.map((s) => panel.vol63[s][k]);
    const cuts = [1, 2, 3, 4].map((j) => quantile(vols, j / 5) as number);
    breakpoints.push(cuts);
    members.forEach((s, position) => {
      const q = Math.floor((position * 5) / members.length);
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
  const latest = endVols.length >= config.factors.minStocksPerDate ? { date: timeToIso(panel.T[N - 1]), values: [1, 2, 3, 4].map((j) => quantile(endVols, j / 5) as number) } : null;
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
// Report
// ---------------------------------------------------------------------------

function pct(x: number | null, digits = 1, signed = false): string {
  if (x === null || !Number.isFinite(x)) return "n/a";
  return `${signed && x > 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;
}

function num(x: number | null, digits = 3, signed = true): string {
  if (x === null || !Number.isFinite(x)) return "n/a";
  return `${signed && x > 0 ? "+" : ""}${x.toFixed(digits)}`;
}

function signText(signs: ReadonlyArray<1 | -1 | 0>): string {
  return signs.map((s) => (s > 0 ? "+" : s < 0 ? "-" : "0")).join(" ");
}

/** docs/factor-research.md, from the two result objects only. */
function renderResearchReport(research: FactorResearch, risk: RiskCalibration): string {
  const lines: string[] = [];
  const push = (...rows: string[]) => lines.push(...rows);
  const periods = research.subperiods.map((p) => `${p.from.slice(0, 4)}-${p.to.slice(0, 4)}`);
  const all = research.factors.flatMap((f) => f.results.map((r) => ({ key: f.key, ...r })));
  const predictive = all.filter((r) => r.verdict === "predictive");
  const best = [...all].sort((a, b) => (a.p ?? 1) - (b.p ?? 1))[0];
  const [main, ...gaps] = research.bias.universeVsBenchmarks;
  const { market, equalWeight } = research.bias.benchmarks;
  const q = risk.quintiles.overall;

  push(
    "# Factor research",
    "",
    "Generated by `npm run research` (scripts/research-factors.ts) from the settings in scripts/evaluation.config.json and the bar cache of `npm run evaluate`. " +
      "Re-running on the same bars reproduces this file, lib/factor-research.json and lib/risk-calibration.json exactly.",
    "",
    "## Summary",
    "",
    predictive.length === 0
      ? `- **No factor passes the adoption rule.** Across ${all.length} pre-registered tests (${research.factors.length} factors x ${research.horizons.length} horizons, signals ${research.from} to ${research.to}, ${research.universe} large US stocks) ` +
          `the smallest p-value is ${num(best?.p ?? null, 3, false)} (${SHORT_LABEL[best.key]}, ${best.days} sessions, IC ${num(best.ic)}), and its Holm-adjusted p is ${num(best?.holmP ?? null, 2, false)}.`
      : `- Predictive under the rule: ${predictive.map((r) => `${SHORT_LABEL[r.key]} at ${r.days} sessions (IC ${num(r.ic)}, Holm p ${num(r.holmP, 3, false)})`).join("; ")}.`,
    `- Low volatility and low beta run against their literature direction on raw returns, but net of beta times ${market}'s return their ICs turn small and positive: ` +
      `the raw pattern is market exposure in a decade when ${market} returned ${pct(main.market)} a year, not stock selection.`,
    `- The universe is today's leaders picked with hindsight: equal-weighted it returned ${pct(main.universe)} a year against ${pct(main.equalWeight)} for ${equalWeight} and ${pct(main.market)} for ${market}.`,
    `- With about ${research.universe} names the smallest IC this design can detect with 80% power is ${research.power.map((p) => `${num(p.minimumDetectableIc, 3, false)} at ${p.days}`).join(", ")} sessions, above typical large-cap factor ICs: the universe cannot validate a factor either way.`,
    `- Risk, unlike return, is forecastable: trailing 63-session volatility ranks next quarter's volatility with a mean rank correlation of ${num(risk.persistence.volatility.mean, 2, false)} (never below ${num(risk.persistence.volatility.min, 2, false)}), ` +
      `trailing beta ranks next quarter's beta at ${num(risk.persistence.beta.mean, 2, false)}, and the volatility forecast's 10-session bands held ${pct(risk.bands.overall.within1)} and ${pct(risk.bands.overall.within2)} of moves (68.3% and 95.4% for normal returns).`,
    "",
    "## Design (fixed before the results)",
    "",
    `- Universe: the ${research.universe} stocks of lib/universe.ts with history; calendar: ${market}'s sessions. Signals every session from ${research.from}; a date counts with at least 20 stocks.`,
    "- Factors at the close of session k, from data up to k only (lib/factors.ts), signed so that higher values are expected to do better:",
    ...research.factors.map((f) => `  - ${f.label}`),
    "- Forward return over h sessions: adjusted open of k + 1 to adjusted close of k + h, minus the same-day equal-weight mean of all stocks (excess).",
    `- Statistic: mean cross-sectional Spearman IC on non-overlapping dates (every h sessions from the first signal), t-test across dates, Holm and Benjamini-Hochberg adjustment over all ${all.length} tests. ` +
      "All-dates ICs with a Newey-West t (lag h) are a robustness check.",
    `- Rule: ${research.rule}`,
    `- Subperiods: ${research.subperiods.map((p) => `${p.from} to ${p.to}`).join(", ")} (by signal date).`,
    "",
    "## Results",
    "",
    `| Factor | h | Dates | Mean IC | t | p | Holm p | BH q | Sign ${periods.join(" / ")} | All dates IC (NW t) | Verdict |`,
    "|---|---:|---:|---:|---:|---:|---:|---:|:---:|---:|---|",
  );
  for (const r of all) {
    push(
      `| ${SHORT_LABEL[r.key]} | ${r.days} | ${r.dates} | ${num(r.ic)} | ${num(r.t, 2)} | ${num(r.p, 3, false)} | ${num(r.holmP, 2, false)} | ${num(r.bhQ, 2, false)} | ${signText(r.signs)} | ` +
        `${num(r.allDates.ic)} (${num(r.allDates.t, 2)}) | ${r.verdict === "predictive" ? "predictive" : "not predictive"} |`,
    );
  }
  push(
    "",
    "### Quintile spreads, turnover and robustness",
    "",
    "Spread: highest minus lowest quintile of same-day excess returns per holding period (quintiles of 15 to 16 stocks). Robustness ICs use the same dates: ranks demeaned within " +
      `sectors; forward returns net of trailing beta times ${market}'s return; and the universe without the ${research.bias.exWinners.length} biggest ex-post winners ` +
      `(${research.bias.exWinners.map((w) => `${w.symbol} ${pct(w.annualReturn, 0)}`).join(", ")} a year).`,
    "",
    "| Factor | h | Q5 - Q1 | t | Top-quintile turnover | Sector-neutral IC | Beta-adjusted IC | Without winners IC |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const r of all) {
    push(
      `| ${SHORT_LABEL[r.key]} | ${r.days} | ${pct(r.spread, 2, true)} | ${num(r.spreadT, 2)} | ${pct(r.turnover, 0)} | ${num(r.sectorNeutralIc)} | ${num(r.betaAdjustedIc)} | ${num(r.exWinnersIc)} |`,
    );
  }
  push(
    "",
    `The technical score is mostly last month's relative move: its mean cross-sectional rank correlation with the trailing 21-session return is ${num(research.bias.technicalVsMonthReturn, 2)}.`,
    "",
    "## Power",
    "",
    "Minimum detectable mean IC (two-sided 5% test, 80% power) from the median standard deviation of the per-date IC across the seven factors:",
    "",
    "| Horizon | Dates | IC standard deviation | Minimum detectable IC |",
    "|---:|---:|---:|---:|",
    ...research.power.map((p) => `| ${p.days} | ${p.dates} | ${num(p.sdIc, 3, false)} | ${num(p.minimumDetectableIc, 3, false)} |`),
    "",
    "Published large-cap factor ICs are about 0.01 to 0.03 per month, so a null here means \"cannot tell\", not \"disproven\". " +
      "The per-date IC varies mostly with time rather than with sampling noise, so more years help more than more names.",
    "",
    "## Hindsight in the universe",
    "",
    `Annualized returns on ${market}'s sessions: the universe equal-weighted and rebalanced daily, ${equalWeight} (equal-weight S&P 500) and ${market}.`,
    "",
    `| Period | Universe | ${equalWeight} | ${market} | Gap vs ${equalWeight} | Gap vs ${market} |`,
    "|---|---:|---:|---:|---:|---:|",
    ...[main, ...gaps].map((g) => {
      const vsEw = g.universe !== null && g.equalWeight !== null ? g.universe - g.equalWeight : null;
      const vsMarket = g.universe !== null && g.market !== null ? g.universe - g.market : null;
      return `| ${g.from} to ${g.to} | ${pct(g.universe)} | ${pct(g.equalWeight)} | ${pct(g.market)} | ${pct(vsEw, 1, true)} | ${pct(vsMarket, 1, true)} |`;
    }),
    "",
    "The gap shrinks toward the date the list was chosen. Hindsight works against momentum too: the losers still in today's list are the ones that recovered.",
    "",
    "## Risk: what the data does forecast",
    "",
    `Window ${risk.window.from} to ${risk.window.to}. The forecast (lib/risk-forecast.ts) is fixed in advance, not tuned: daily volatility = sqrt(${risk.estimator.shortWeight} x var${risk.estimator.shortWindow} + ` +
      `${1 - risk.estimator.shortWeight} x var${risk.estimator.longWindow}) of daily log returns, the simplest mix of short and long memory (HAR models, Corsi 2009).`,
    "",
    `- Persistence over the next ${risk.persistence.horizon} sessions (${risk.persistence.dates} non-overlapping dates): trailing 63-session volatility vs realized volatility, mean rank correlation ` +
      `${num(risk.persistence.volatility.mean, 3, false)} (min ${num(risk.persistence.volatility.min, 3, false)}, t ${num(risk.persistence.volatility.t, 1, false)}); trailing 252-session beta vs realized beta ` +
      `${num(risk.persistence.beta.mean, 3, false)} (min ${num(risk.persistence.beta.min, 3, false)}, t ${num(risk.persistence.beta.t, 1, false)}).`,
    `- ${risk.bands.horizon}-session bands over ${risk.bands.overall.n} stock-days: inside plus/minus 1 sigma ${pct(risk.bands.overall.within1)}, inside 2 sigma ${pct(risk.bands.overall.within2)} ` +
      `(20-session volatility alone: ${pct(risk.bands.shortWindowOnly.within1)} and ${pct(risk.bands.shortWindowOnly.within2)}). Tails are fatter than normal, so the 2-sigma band is approximate.`,
    ...risk.bands.subperiods.map((p) => `  - ${p.from.slice(0, 4)} to ${p.to.slice(0, 4)}: ${pct(p.within1)} / ${pct(p.within2)} (${p.n} stock-days)`),
    `- QLIKE loss (lower is better) over ${risk.qlike.n} stock-days: blend ${num(risk.qlike.blend, 3, false)} against ${num(risk.qlike.shortWindowOnly, 3, false)} for the 20-session estimate.`,
    "",
    `### How bad a normal month was, by volatility quintile`,
    "",
    `Stock-months on a ${risk.quintiles.horizon}-session grid, quintiles of trailing ${risk.quintiles.measure} across the universe on each date (Q1 lowest).`,
    "",
    `| Quintile | Stock-months | Median volatility | Drop of ${pct(-risk.quintiles.threshold, 0)} or more from a peak within ${risk.quintiles.horizon} sessions | Return of ${pct(risk.quintiles.threshold, 0)} or worse over ${risk.quintiles.horizon} sessions |`,
    "|---|---:|---:|---:|---:|",
    ...q.map((row) => `| Q${row.quintile} | ${row.n} | ${pct(row.medianVolatility, 0)} | ${pct(row.drawdown)} | ${pct(row.loss)} |`),
    "",
    `By subperiod, share with a drop of ${pct(-risk.quintiles.threshold, 0)} or more (Q1 to Q5):`,
    "",
    ...risk.quintiles.subperiods.map((p) => `- ${p.from.slice(0, 4)} to ${p.to.slice(0, 4)}: ${p.rows.map((row) => pct(row.drawdown)).join(" / ")}`),
    "",
    `Quintile boundaries (annualized volatility): median over dates ${risk.quintiles.breakpoints.median.map((v) => pct(v, 0)).join(", ")}` +
      `${risk.quintiles.breakpoints.latest ? `; on ${risk.quintiles.breakpoints.latest.date} ${risk.quintiles.breakpoints.latest.values.map((v) => pct(v, 0)).join(", ")}` : ""}.`,
    "",
    "## Limitations",
    "",
    "- Hindsight universe: 78 of today's largest stocks, chosen in 2026. Delisted and shrunken companies are missing, which flatters returns and favours stocks that fell and recovered. " +
      "A point-in-time universe (historical index membership) is the fix and is not available from Yahoo.",
    "- Power: with this few names and years, realistic factor ICs are below what the tests can detect. A null result here does not refute the published evidence.",
    "- Regime: one decade, mostly a strong US bull market. Low-risk and reversal effects are known to depend on the market's volatility.",
    "- Data: Yahoo daily charts, dividend and split adjusted; returns before costs; no fundamentals (they have no point-in-time history here). " +
      "Yahoo recomputes adjusted closes in single precision on every request, so a fresh download can move the last digits; the cached bars reproduce every number exactly.",
    "- What the app does with this: it shows these factors as descriptive percentiles with their measured IC, never as a buy or sell signal, and puts the risk numbers first.",
    "",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const config = readConfig(arg("config", DEFAULT_CONFIG_PATH));
  const cacheDir = arg("cache", DEFAULT_CACHE_DIR);
  const offline = process.argv.includes("--offline");
  const { market, equalWeight } = config.data;
  console.log(`${offline ? "Reading" : "Downloading"} daily bars from ${config.data.from} (cache: ${cacheDir})`);
  const bars = await loadBars({ symbols: [...UNIVERSE_STOCKS, market, equalWeight], from: config.data.from, cacheDir, offline });

  const panel = buildPanel(bars, market, config.factors.window, config.factors.minStocksPerDate);
  const research = researchFactors(panel, config, bars[equalWeight] ?? []);
  const riskPanel = config.risk.window.to === config.factors.window.to ? panel : buildPanel(bars, market, config.risk.window, config.factors.minStocksPerDate);
  const risk = calibrateRisk(riskPanel, config);

  const outPath = arg("out", "docs/factor-research.md");
  const factorsPath = arg("factors", "lib/factor-research.json");
  const riskPath = arg("risk", "lib/risk-calibration.json");
  writeFileSync(outPath, renderResearchReport(research, risk));
  writeFileSync(factorsPath, `${JSON.stringify(research, roundReplacer, 2)}\n`);
  writeFileSync(riskPath, `${JSON.stringify(risk, roundReplacer, 2)}\n`);
  console.log(`Wrote ${outPath}, ${factorsPath} and ${riskPath} (${panel.symbols.length} stocks, signals ${research.from} to ${research.to}).`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
