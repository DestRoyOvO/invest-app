/**
 * Offline evaluation of InvestSeek's technical signal.
 *
 * For every stock in the heatmap universe it downloads daily history, recomputes the technical composite for every
 * session (the same code path as the live signal, with no look-ahead), and measures what happened next:
 *   - forward returns by signal label versus the unconditional base rate of the same universe and period,
 *   - hit rates with Wilson 95% intervals,
 *   - the cross-sectional rank IC (Spearman correlation between score and forward return across stocks on a day),
 *     sampled on non-overlapping dates so the t-statistic is not inflated by overlapping returns,
 *   - the same statistics for the first and second half of the period, as a stability check.
 *
 * It writes a readable report (docs/evaluation.md) and a compact summary the app shows next to the live signal
 * (lib/signal-evaluation.json).
 *
 * Fundamental factors are excluded because point-in-time fundamentals are not available.
 * The universe is today's large caps, so results carry survivorship bias. This is research, not a trading system.
 *
 * Usage: npm run evaluate -- [--years 3] [--out docs/evaluation.md] [--json lib/signal-evaluation.json]
 */

import { writeFileSync } from "node:fs";

import YahooFinance from "yahoo-finance2";

import { normalizeBars, type DailyBar } from "../lib/bars";
import { evaluationVerdict, type HorizonOutcome, type LabelOutcome, type SignalEvaluation } from "../lib/evaluation";
import { FACTOR_WEIGHTS, labelForScore, MODEL_VERSION, SIGNAL_THRESHOLDS, technicalScoreSeries } from "../lib/signal";
import { mean, sampleStd, wilsonInterval } from "../lib/stats";
import { UNIVERSE_STOCKS } from "../lib/universe";
import type { SignalCode } from "../types/api";

const HORIZONS = [5, 10, 20] as const;
type Horizon = (typeof HORIZONS)[number];
const LABELS: SignalCode[] = ["strong_bullish", "bullish", "neutral", "bearish", "strong_bearish"];
const MIN_STOCKS_FOR_IC = 20;

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const years = Number(arg("years", "3"));
const outPath = arg("out", "docs/evaluation.md");
const jsonPath = arg("json", "lib/signal-evaluation.json");

const yf = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
  versionCheck: false,
  validation: { logErrors: false, logOptionsErrors: false },
});

interface Observation {
  symbol: string;
  t: number;
  score: number;
  label: SignalCode;
  forward: Partial<Record<Horizon, number>>;
}

async function loadBars(symbol: string): Promise<DailyBar[]> {
  const period1 = new Date(Date.now() - years * 365.25 * 86_400_000);
  const chart = await yf.chart(symbol, { period1, interval: "1d" }, { validateResult: false });
  return normalizeBars(chart as unknown as Parameters<typeof normalizeBars>[0]);
}

/** Signal at the close of session i; enter at the next session's open, exit at the close h sessions after the signal. */
function forwardReturn(bars: DailyBar[], i: number, h: number): number | null {
  const entry = bars[i + 1];
  const exit = bars[i + h];
  if (!entry || !exit || h < 1) return null;
  const adjustedOpen = entry.o * (entry.adjClose / entry.c);
  if (!(adjustedOpen > 0) || !(exit.adjClose > 0)) return null;
  return exit.adjClose / adjustedOpen - 1;
}

function observationsFor(symbol: string, bars: DailyBar[]): Observation[] {
  const series = technicalScoreSeries(bars);
  const out: Observation[] = [];
  series.forEach((point, i) => {
    if (point.score === null) return;
    const forward: Partial<Record<Horizon, number>> = {};
    for (const h of HORIZONS) {
      const r = forwardReturn(bars, i, h);
      if (r !== null) forward[h] = r;
    }
    out.push({ symbol, t: point.t, score: point.score, label: labelForScore(point.score), forward });
  });
  return out;
}

function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  for (let k = 0; k < order.length; ) {
    let j = k;
    while (j + 1 < order.length && order[j + 1][0] === order[k][0]) j++;
    const average = (k + j) / 2 + 1;
    for (let m = k; m <= j; m++) out[order[m][1]] = average;
    k = j + 1;
  }
  return out;
}

function pearson(x: number[], y: number[]): number | null {
  const mx = mean(x);
  const my = mean(y);
  if (mx === null || my === null) return null;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

function spearman(x: number[], y: number[]): number | null {
  return x.length >= 3 ? pearson(ranks(x), ranks(y)) : null;
}

function forwardReturns(observations: Observation[], h: Horizon): number[] {
  return observations.map((o) => o.forward[h]).filter((r): r is number => r !== undefined);
}

function hitStats(returns: number[]) {
  const wins = returns.filter((r) => r > 0).length;
  return {
    n: returns.length,
    mean: mean(returns),
    hitRate: returns.length ? wins / returns.length : null,
    hitCI: wilsonInterval(wins, returns.length),
  };
}

/** Mean daily cross-sectional rank IC on non-overlapping dates (every h-th date). */
function rankIc(observations: Observation[], h: Horizon): HorizonOutcome["ic"] {
  const byDate = new Map<number, Observation[]>();
  for (const o of observations) {
    if (o.forward[h] === undefined) continue;
    const list = byDate.get(o.t) ?? [];
    list.push(o);
    byDate.set(o.t, list);
  }
  const dates = [...byDate.keys()].sort((a, b) => a - b).filter((_, i) => i % h === 0);
  const ics: number[] = [];
  for (const date of dates) {
    const day = byDate.get(date) ?? [];
    if (day.length < MIN_STOCKS_FOR_IC) continue;
    const ic = spearman(
      day.map((o) => o.score),
      day.map((o) => o.forward[h] as number),
    );
    if (ic !== null) ics.push(ic);
  }
  const m = mean(ics);
  const sd = sampleStd(ics);
  return { mean: m, t: m !== null && sd && ics.length > 1 ? m / (sd / Math.sqrt(ics.length)) : null, dates: ics.length };
}

function horizonOutcome(observations: Observation[], h: Horizon): HorizonOutcome {
  const base = hitStats(forwardReturns(observations, h));
  const labels: LabelOutcome[] = LABELS.map((code) => {
    const stats = hitStats(forwardReturns(observations.filter((o) => o.label === code), h));
    return { code, ...stats, excess: stats.mean !== null && base.mean !== null ? stats.mean - base.mean : null };
  });
  return { days: h, base: { n: base.n, mean: base.mean, hitRate: base.hitRate }, ic: rankIc(observations, h), labels };
}

const pct = (x: number | null, digits = 2) => (x === null ? "n/a" : `${(x * 100).toFixed(digits)}%`);
const num = (x: number | null, digits = 3) => (x === null ? "n/a" : x.toFixed(digits));

const VERDICT_TEXT = {
  predictive: "higher scores were followed by higher returns",
  inverse: "higher scores were followed by lower returns",
  none: "no reliable relationship between score and forward return",
} as const;

function section(title: string, observations: Observation[]): string {
  const lines: string[] = [`### ${title}`, ""];
  for (const h of HORIZONS) {
    const outcome = horizonOutcome(observations, h);
    const { base, ic } = outcome;
    lines.push(`**${h}-session forward return** (base rate: mean ${pct(base.mean)}, hit rate ${pct(base.hitRate, 1)}, n = ${base.n})`, "");
    lines.push("| Label | Observations | Mean return | Excess vs base | Hit rate | Hit rate 95% CI |", "|---|---:|---:|---:|---:|---:|");
    for (const b of outcome.labels) {
      lines.push(
        `| ${b.code} | ${b.n} | ${pct(b.mean)} | ${pct(b.excess)} | ${pct(b.hitRate, 1)} | ${b.hitCI ? `${pct(b.hitCI[0], 1)} – ${pct(b.hitCI[1], 1)}` : "n/a"} |`,
      );
    }
    lines.push(
      "",
      `Rank IC (non-overlapping dates): mean ${num(ic.mean)}, t = ${num(ic.t, 2)}, dates = ${ic.dates} (${VERDICT_TEXT[evaluationVerdict(outcome)]}).`,
      "",
    );
  }
  return lines.join("\n");
}

function summaryLines(outcomes: HorizonOutcome[]): string[] {
  return outcomes.map((o) => {
    const ranked = o.labels.filter((l) => l.excess !== null).sort((a, b) => (b.excess ?? 0) - (a.excess ?? 0));
    const best = ranked[0];
    return (
      `- ${o.days} sessions: rank IC ${num(o.ic.mean)} (t = ${num(o.ic.t, 2)}), ${VERDICT_TEXT[evaluationVerdict(o)]}.` +
      (best ? ` Best label by excess return: ${best.code} (${pct(best.excess)} vs base, n = ${best.n}).` : "")
    );
  });
}

/** Rounds every non-integer to 5 decimals so the committed JSON stays small and diffs stay readable. */
function roundReplacer(_key: string, value: unknown): unknown {
  return typeof value === "number" && !Number.isInteger(value) ? Number(value.toFixed(5)) : value;
}

async function main() {
  const symbols = UNIVERSE_STOCKS;
  const observations: Observation[] = [];
  const failed: string[] = [];
  let firstDate = Infinity;
  let lastDate = -Infinity;

  for (const symbol of symbols) {
    try {
      const bars = await loadBars(symbol);
      const obs = observationsFor(symbol, bars);
      for (const o of obs) {
        firstDate = Math.min(firstDate, o.t);
        lastDate = Math.max(lastDate, o.t);
      }
      observations.push(...obs);
      process.stdout.write(`${symbol} ${obs.length}  `);
    } catch (error) {
      failed.push(symbol);
      console.error(`\n${symbol}: ${String(error).slice(0, 120)}`);
    }
  }
  process.stdout.write("\n");
  if (observations.length === 0) throw new Error("No observations: every symbol failed to load.");

  const sorted = [...new Set(observations.map((o) => o.t))].sort((a, b) => a - b);
  const midpoint = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const generated = new Date().toISOString().slice(0, 10);
  const outcomes = HORIZONS.map((h) => horizonOutcome(observations, h));
  const universe = symbols.length - failed.length;

  const report = [
    "# Signal evaluation",
    "",
    `Generated ${generated} by \`npm run evaluate\` (scripts/evaluate-signal.ts), model v${MODEL_VERSION}.`,
    "",
    `- Universe: ${universe} large US stocks from the sector heatmap${failed.length ? ` (failed to load: ${failed.join(", ")})` : ""}.`,
    `- Period: signals from ${iso(firstDate)} to ${iso(lastDate)} (${years} years of history requested; the first 120 sessions of each stock are warm-up).`,
    "- Signal: the technical composite only (momentum, trend, RSI, volume, volatility regime), labelled with the live thresholds " +
      `(very strong >= ${SIGNAL_THRESHOLDS.strongBullish}, strong >= ${SIGNAL_THRESHOLDS.bullish}, weak <= ${SIGNAL_THRESHOLDS.bearish}, very weak <= ${SIGNAL_THRESHOLDS.strongBearish}). ` +
      "The tables use the internal codes: strong_bullish = very strong, bullish = strong, bearish = weak, strong_bearish = very weak.",
    "- Returns: enter at the next session's open, exit at the close h sessions after the signal, dividend and split adjusted, before costs.",
    "- Caveats: survivorship bias (today's constituents), overlapping observations within each label table, no transaction costs, one market regime. Treat small excess returns as noise unless the interval and the IC t-statistic agree.",
    "",
    "## Summary",
    "",
    ...summaryLines(outcomes),
    "",
    "A relationship counts as reliable when |t| >= 2 on non-overlapping dates. Label tables overlap heavily and cluster in time (for example around sharp sell-offs), so their intervals are narrower than the real uncertainty.",
    "",
    "## Detail",
    "",
    section("Full period", observations),
    section(`First half (to ${iso(midpoint)})`, observations.filter((o) => o.t < midpoint)),
    section(`Second half (from ${iso(midpoint)})`, observations.filter((o) => o.t >= midpoint)),
  ].join("\n");

  const summary: SignalEvaluation = {
    generated,
    from: iso(firstDate),
    to: iso(lastDate),
    universe,
    observations: observations.length,
    model: { version: MODEL_VERSION, thresholds: { ...SIGNAL_THRESHOLDS }, weights: { ...FACTOR_WEIGHTS } },
    horizons: outcomes,
  };

  writeFileSync(outPath, `${report}\n`);
  writeFileSync(jsonPath, `${JSON.stringify(summary, roundReplacer, 2)}\n`);
  console.log(`\nWrote ${outPath} and ${jsonPath} (${observations.length} observations).`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
