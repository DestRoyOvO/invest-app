/**
 * Offline evaluation of InvestSeek's technical score (npm run evaluate).
 *
 * For every stock in the heatmap universe it loads daily history, recomputes the technical score and its factors for
 * every session (the live code path, no look-ahead) and measures what followed, over a window pinned in
 * scripts/evaluation.config.json so the result does not depend on the day the script runs:
 *   - the cross-sectional rank IC on all dates with a Newey-West t (the primary statistic) and its spread over the
 *     non-overlapping grid phases,
 *   - per reading: the excess return split into market timing and stock selection, the beat-median rate, how many
 *     dates and episodes the readings come from, and moving-block bootstrap intervals over dates,
 *   - a holdout decade the model was never designed on, tested with a rule fixed in advance,
 *   - the hindsight gap: how far the hand-picked universe beat RSP and SPY.
 * The statistics live in lib/evaluation.ts (pure, tested); this file only loads bars and writes the outputs:
 * docs/evaluation.md and the compact lib/signal-evaluation.json the app shows next to the live score.
 *
 * Data: Yahoo daily charts are downloaded into a cache directory outside the repository (one JSON file per symbol);
 * --offline reads that cache without calling Yahoo, so a run can be repeated exactly. A bar still forming when it was
 * downloaded is dropped. Fundamentals are excluded because point-in-time fundamentals are not available. The universe
 * is today's large caps, so results carry survivorship and selection bias. This is research, not a trading system.
 *
 * A run stops when a download fails or a symbol's bars end before the market's last session in the window, because an
 * older cached file would otherwise mix into the results; --allow-partial goes on with a warning instead.
 *
 * Usage: npm run evaluate -- [--offline] [--cache <dir>] [--allow-partial] [--config scripts/evaluation.config.json]
 *                            [--out docs/evaluation.md] [--json lib/signal-evaluation.json]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import YahooFinance from "yahoo-finance2";
import { z } from "zod";

import { normalizeBars, type DailyBar, type RawChart } from "../lib/bars";
import {
  dropFormingBar,
  evaluateSignalModel,
  evaluationVerdict,
  staleSymbols,
  type EvaluationConfig,
  type HoldoutTest,
  type Interval,
  type SignalEvaluation,
} from "../lib/evaluation";
import { FACTOR_WEIGHTS, MODEL_VERSION, SIGNAL_THRESHOLDS, TECHNICAL_FACTORS, V3_FACTOR_WEIGHTS, type TechnicalFactorKey } from "../lib/signal";
import { UNIVERSE_STOCKS } from "../lib/universe";
import type { FactorKey } from "../types/api";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = z.object({ from: isoDate, to: isoDate });

export const configSchema = z.object({
  data: z.object({ from: isoDate, market: z.string().min(1), equalWeight: z.string().min(1) }),
  signal: z.object({
    main: range,
    holdout: range,
    horizons: z.array(z.number().int().positive()).min(1),
    minStocksPerDate: z.number().int().positive(),
    episodeGapSessions: z.number().int().positive(),
    bootstrap: z.object({ blockLength: z.number().int().positive(), reps: z.number().int().positive(), seed: z.number().int() }),
    holdoutTest: z.object({ horizon: z.number().int().positive(), alpha: z.number().gt(0).lt(1) }),
    subperiods: z.array(range),
  }),
  factors: z.object({
    window: range,
    horizons: z.array(z.number().int().positive()).min(1),
    minStocksPerDate: z.number().int().positive(),
    alpha: z.number().gt(0).lt(1),
    excludeWinners: z.number().int().nonnegative(),
    subperiods: z.array(range).min(1),
  }),
  risk: z.object({
    window: range,
    bandHorizon: z.number().int().positive(),
    persistenceHorizon: z.number().int().positive(),
    drawdownHorizon: z.number().int().positive(),
    drawdownThreshold: z.number().lt(0),
    subperiods: z.array(range).min(1),
  }),
});

export type ScriptConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG_PATH = "scripts/evaluation.config.json";

export function readConfig(path = DEFAULT_CONFIG_PATH): ScriptConfig {
  return configSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

// ---------------------------------------------------------------------------
// Bar cache
// ---------------------------------------------------------------------------

/** Where downloaded bars are kept unless --cache says otherwise: outside the repository, shared by both scripts. */
export const DEFAULT_CACHE_DIR = join(homedir(), ".cache", "investseek", "bars");

/** One cached symbol: normalized daily bars plus when and from which date they were downloaded. */
interface CacheFile {
  symbol: string;
  fetchedAt: string;
  from: string;
  bars: DailyBar[];
}

const cacheFileSchema = z.object({
  symbol: z.string(),
  fetchedAt: z.string(),
  from: z.string().optional(),
  // Normalized bars (this script) or a raw chart result (older research caches); either is accepted.
  bars: z.array(z.object({ t: z.number(), o: z.number(), h: z.number(), l: z.number(), c: z.number(), adjClose: z.number(), v: z.number().nullable() })).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  quotes: z.array(z.record(z.string(), z.unknown())).optional(),
});

function cachePath(dir: string, symbol: string): string {
  return join(dir, `${symbol}.json`);
}

/** Completed bars of one cached symbol (a bar still forming at download time is dropped), or null if not cached. */
export function readCachedBars(dir: string, symbol: string): DailyBar[] | null {
  const path = cachePath(dir, symbol);
  if (!existsSync(path)) return null;
  const file = cacheFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const bars = file.bars ?? normalizeBars({ meta: file.meta, quotes: file.quotes } as RawChart);
  return dropFormingBar(bars, file.fetchedAt);
}

/** Downloads daily charts into the cache, at most three requests at a time. Returns the symbols that failed. */
export async function fetchToCache(symbols: readonly string[], from: string, dir: string): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const yf = new YahooFinance({
    suppressNotices: ["yahooSurvey", "ripHistorical"],
    versionCheck: false,
    queue: { concurrency: 3 },
    validation: { logErrors: false, logOptionsErrors: false },
  });
  const queue = [...symbols];
  const failed: string[] = [];
  const worker = async () => {
    for (let symbol = queue.shift(); symbol !== undefined; symbol = queue.shift()) {
      try {
        const fetchedAt = new Date().toISOString();
        const chart = await yf.chart(symbol, { period1: new Date(`${from}T00:00:00Z`), interval: "1d" }, { validateResult: false });
        const file: CacheFile = { symbol, fetchedAt, from, bars: normalizeBars(chart as unknown as RawChart) };
        writeFileSync(cachePath(dir, symbol), JSON.stringify(file));
        process.stdout.write(`${symbol} ${file.bars.length}  `);
      } catch (error) {
        failed.push(symbol);
        console.error(`\n${symbol}: ${String(error).slice(0, 160)}`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  process.stdout.write("\n");
  return failed.sort();
}

export interface LoadOptions {
  symbols: readonly string[];
  from: string;
  cacheDir: string;
  /** Read the cache only, never call Yahoo. */
  offline: boolean;
  /** Go on when a download fails, with whatever older file the cache holds for that symbol. */
  allowPartial?: boolean;
}

/**
 * Bars per symbol from the cache, refreshed from Yahoo first unless offline. Symbols without data map to []. Throws when
 * a download fails, unless allowPartial: the cache would still hold an older file for that symbol.
 */
export async function loadBars(options: LoadOptions): Promise<Record<string, DailyBar[]>> {
  if (!options.offline) {
    const failed = await fetchToCache(options.symbols, options.from, options.cacheDir);
    if (failed.length > 0) {
      const problem = `Download failed for ${failed.join(", ")}; the cache holds an older file or nothing for them.`;
      if (!options.allowPartial) throw new Error(`${problem} Run again, or pass --allow-partial to go on with the cache.`);
      console.warn(`${problem} Going on because of --allow-partial.`);
    }
  }
  const out: Record<string, DailyBar[]> = {};
  for (const symbol of options.symbols) out[symbol] = readCachedBars(options.cacheDir, symbol) ?? [];
  return out;
}

/**
 * Stops the run when a symbol's bars end before the market's last session up to `to` (a failed or older download in
 * the cache), unless allowPartial, which only warns. Shared by npm run evaluate and npm run research.
 */
export function checkCoverage(bars: Readonly<Record<string, readonly DailyBar[]>>, symbols: readonly string[], market: string, to: string, allowPartial: boolean): void {
  const stale = staleSymbols(bars, symbols, market, to);
  if (stale.length === 0) return;
  const problem = `Bars end before ${market}'s last session up to ${to} for ${stale.join(", ")}.`;
  if (!allowPartial) throw new Error(`${problem} Refresh the cache (run without --offline), or pass --allow-partial to go on.`);
  console.warn(`${problem} Going on because of --allow-partial.`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const READING: Record<string, string> = {
  strong_bullish: "Very strong",
  bullish: "Strong",
  neutral: "Neutral",
  bearish: "Weak",
  strong_bearish: "Very weak",
};

const VERDICT_TEXT = {
  predictive: "higher scores were followed by higher returns",
  inverse: "higher scores were followed by lower returns",
  none: "no reliable relationship",
} as const;

const FACTOR_NAME: Record<HoldoutTest["key"], string> = {
  composite: "Technical score (composite)",
  momentum: "Momentum",
  trend: "Trend",
  rsi: "RSI",
  volume: "Volume",
  volatility: "Volatility regime",
};

function pct(x: number | null, digits = 2, sign = true): string {
  if (x === null || !Number.isFinite(x)) return "n/a";
  const value = (x * 100).toFixed(digits);
  return `${sign && x > 0 ? "+" : ""}${value}%`;
}

function num(x: number | null, digits = 3, sign = true): string {
  if (x === null || !Number.isFinite(x)) return "n/a";
  return `${sign && x > 0 ? "+" : ""}${x.toFixed(digits)}`;
}

function interval(ci: Interval | null, digits = 2, sign = true): string {
  return ci === null ? "n/a" : `${pct(ci[0], digits, sign)} to ${pct(ci[1], digits, sign)}`;
}

function share(x: number | null): string {
  return x === null ? "n/a" : `${Math.round(x * 100)}%`;
}

/** docs/evaluation.md: a pure function of the evaluation and its config, so the file is as reproducible as the JSON. */
export function renderEvaluationReport(
  evaluation: SignalEvaluation,
  config: EvaluationConfig,
  symbols: { market: string; equalWeight: string; dataFrom: string },
): string {
  const lines: string[] = [];
  const push = (...rows: string[]) => lines.push(...rows);
  const { holdout, hindsight } = evaluation;
  const horizonsText = config.horizons.join(" / ");
  // Describe the score from the weights it ran with, so the text stays right when the model changes.
  const weights = evaluation.model.weights;
  const inSentence = (key: (typeof TECHNICAL_FACTORS)[number]) => (key === "rsi" ? "RSI" : FACTOR_NAME[key].toLowerCase());
  const list = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join(""));
  const directional = TECHNICAL_FACTORS.filter((key) => weights[key] > 0).map(inSentence);
  const unweighted = TECHNICAL_FACTORS.filter((key) => weights[key] === 0).map(inSentence);
  const factorName = (key: HoldoutTest["key"]) => (key !== "composite" && weights[key] === 0 ? `${FACTOR_NAME[key]} (no weight)` : FACTOR_NAME[key]);
  // Whether the weighted factors keep the proportions of the v3 priors (v4 only rescaled them), so the text can say so.
  const weighted = (Object.keys(weights) as FactorKey[]).filter((key) => weights[key] > 0);
  const scale = weighted.map((key) => weights[key] / V3_FACTOR_WEIGHTS[key]);
  const rescaledPriors = scale.length > 0 && scale.every((s) => Math.abs(s - scale[0]) < 1e-4);
  // The holdout never fitted a weight, but a factor dropped after seeing it makes it a weaker test of the current model.
  const holdoutUse =
    unweighted.length === 0
      ? "the model's weights were never fitted to these years"
      : `no weight was fitted to these years, but model v${evaluation.model.version} dropped the ${list(unweighted)} after seeing them`;
  const passed = holdout.factors
    .filter((f) => f.pass)
    .map((f) => f.key)
    .filter((key): key is TechnicalFactorKey => key !== "composite")
    .map(inSentence);

  push(
    "# Signal evaluation",
    "",
    `Generated by \`npm run evaluate\` (scripts/evaluate-signal.ts) for model v${evaluation.model.version}, from the settings pinned in scripts/evaluation.config.json. ` +
      "Re-running on the same cached bars (`npm run evaluate -- --offline`) reproduces this file and lib/signal-evaluation.json exactly.",
    "",
    "## What is measured",
    "",
    `- Universe: ${evaluation.universe} large US stocks from the sector heatmap (lib/universe.ts). A stock enters once it has 120 sessions of history.`,
    `- Signal: the technical score, recomputed for every session from data up to that session (the live code path). It combines ${list(directional)}` +
      `${unweighted.length > 0 ? `; the ${list(unweighted)} ${unweighted.length > 1 ? "are" : "is"} still computed but ${unweighted.length > 1 ? "have" : "has"} no weight` : ""}. Readings use the live cut-offs ` +
      `(very strong >= ${evaluation.model.thresholds.strongBullish}, strong >= ${evaluation.model.thresholds.bullish}, weak <= ${evaluation.model.thresholds.bearish}, very weak <= ${evaluation.model.thresholds.strongBearish}).`,
    `- Window: signals from ${evaluation.from} to ${evaluation.to} (pinned ${evaluation.period.from} to ${evaluation.period.to}). Bars after the window end are not used, not even as exit prices, so the last ${Math.max(...config.horizons)} sessions only count at the shorter horizons.`,
    `- Returns: bought at the next session's open, sold at the close ${horizonsText} sessions after the signal, dividend and split adjusted, before costs. A date counts when at least ${config.minStocksPerDate} stocks have a forward return.`,
    "",
    "## Summary",
    "",
    "| Horizon | Rank IC | Newey-West t (lag h) | t (lag 2h) | t over grid phases | Verdict |",
    "|---|---:|---:|---:|---:|---|",
  );
  for (const h of evaluation.horizons) {
    const verdict = evaluationVerdict(h);
    push(
      `| ${h.days} sessions | ${num(h.ic.mean)} | ${num(h.ic.t, 2)} | ${num(h.ic.t2, 2)} | ${h.ic.phaseT ? `${num(h.ic.phaseT[0], 2)} to ${num(h.ic.phaseT[1], 2)}` : "n/a"} | ${VERDICT_TEXT[verdict]}${h.ic.fragile ? " (fragile: grid phases disagree)" : ""} |`,
    );
  }
  const reliable = evaluation.horizons.filter((h) => evaluationVerdict(h) !== "none");
  push(
    "",
    reliable.length === 0
      ? `At no horizon does the Newey-West t reach |t| = 2: over this decade the technical score has **not predicted** which of these stocks did better. It describes short-term relative strength.`
      : `The Newey-West t reaches |t| = 2 at ${reliable.map((h) => `${h.days} sessions`).join(", ")}. Read it together with the holdout and the hindsight gap below before treating it as an edge.`,
    "",
    `Holdout ${holdout.from} to ${holdout.to} (${holdoutUse}): the composite's ${holdout.horizon}-session rank IC is ${num(holdout.composite.mean)} ` +
      `(Newey-West t ${num(holdout.composite.t, 2)}, 95% CI ${holdout.composite.ci ? `${num(holdout.composite.ci[0])} to ${num(holdout.composite.ci[1])}` : "n/a"}), ` +
      `${holdout.composite.pass ? "which passes" : "which does not pass"} the one-sided 5% test; ` +
      `${holdout.factors.filter((f) => f.pass).length === 0 ? "none of the five technical factors passes" : `${holdout.factors.filter((f) => f.pass).map((f) => f.key).join(", ")} pass`} the Holm-adjusted test.`,
    "",
    `Hindsight gap: the universe, equal-weighted, returned ${pct(hindsight.main.universe, 1, false)} a year over the window against ${pct(hindsight.main.equalWeight, 1, false)} for ${symbols.equalWeight} and ${pct(hindsight.main.market, 1, false)} for ${symbols.market}. ` +
      `The ${evaluation.universe} names are today's leaders, picked with hindsight, so every absolute return below is flattered.`,
    "",
  );

  push(
    "## Readings and what followed",
    "",
    "Each reading's mean excess return over all observations splits exactly into **timing** (the same-day universe was up or down when the reading occurred) and **selection** " +
      "(the stock against the equal-weight universe on the same day). Selection is the part a stock picker could use. Readings cluster in sell-offs and rallies, so the intervals " +
      `come from a moving-block bootstrap over dates (${config.bootstrap.blockLength}-session blocks, ${config.bootstrap.reps} replicates, seed ${config.bootstrap.seed}); ` +
      `an episode is a run of dates with gaps of at most ${config.episodeGapSessions} sessions.`,
    "",
  );
  for (const h of evaluation.horizons) {
    push(
      `### ${h.days} sessions`,
      "",
      `All observations: mean ${pct(h.base.mean)}, up ${share(h.base.hitRate)}, n = ${h.base.n}.`,
      "",
      "| Reading | Obs | Dates | Episodes (largest) | Selection [95% CI] | Timing | Raw excess [95% CI] | Up [95% CI] | Beat median |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    );
    for (const l of h.labels) {
      push(
        `| ${READING[l.code]} | ${l.n} | ${l.dates} | ${l.episodes} (${share(l.largestEpisodeShare)}) | ${pct(l.selection)} [${interval(l.ci.selection)}] | ${pct(l.timing)} | ` +
          `${pct(l.excess)} [${interval(l.ci.excess)}] | ${share(l.hitRate)} [${interval(l.ci.hitRate, 0, false)}] | ${share(l.beatMedian)} |`,
      );
    }
    push("");
  }

  push(
    "## Holdout decade",
    "",
    `Signals ${holdout.from} to ${holdout.to}, the decade before the window the model was first evaluated on (2024-04-30 to 2026-11-06). ` +
      `The rule was fixed before the run: primary horizon ${holdout.horizon} sessions, all-dates rank IC with a Newey-West t, one-sided in the designed direction ` +
      `(a higher score should precede a higher return), the composite tested at ${holdout.alpha * 100}% and the five technical factors with Holm's adjustment at ${holdout.alpha * 100}%. ` +
      (!holdout.composite.pass && passed.length === 0
        ? "Neither the composite nor any factor passes, so the score is described as short-term relative strength, not as a forecast."
        : `${holdout.composite.pass ? "The composite passes" : "The composite does not pass"}; ${passed.length === 0 ? "no factor passes" : `${list(passed)} ${passed.length > 1 ? "pass" : "passes"}`}.`),
    "",
    unweighted.length === 0
      ? "The weights are hand-set priors and were never fitted to these years."
      : `No weight was fitted to these years, but model v${evaluation.model.version} took the ${list(unweighted)} out of the score after seeing this table` +
          `${rescaledPriors ? " and only rescaled the other hand-set weights in proportion" : ""}. For the current model the decade is therefore no longer an independent test; ` +
          "the per-factor rows do not depend on the weights.",
    "",
    "| Signal | Rank IC | Newey-West t | One-sided p | Holm p | Passes |",
    "|---|---:|---:|---:|---:|---|",
  );
  for (const test of [holdout.composite, ...holdout.factors]) {
    push(`| ${factorName(test.key)} | ${num(test.mean, 4)} | ${num(test.t, 2)} | ${num(test.p, 3, false)} | ${test.holmP === null ? "-" : num(test.holmP, 3, false)} | ${test.pass ? "yes" : "no"} |`);
  }
  push(
    "",
    `Composite at the other horizons (descriptive): ${holdout.horizons.map((x) => `${x.days} sessions ${num(x.mean, 4)} (t ${num(x.t, 2)})`).join(", ")}.`,
    "",
    "## Subperiods",
    "",
    `Rank IC (Newey-West t) by calendar subperiod of the window, descriptive.`,
    "",
    `| Horizon | ${config.subperiods.map((p) => `${p.from.slice(0, 4)} to ${p.to.slice(0, 4)}`).join(" | ")} |`,
    `|---|${config.subperiods.map(() => "---:").join("|")}|`,
  );
  for (const h of evaluation.horizons) {
    push(`| ${h.days} sessions | ${h.subperiods.map((p) => `${num(p.mean)} (${num(p.t, 2)})`).join(" | ")} |`);
  }
  push(
    "",
    "## Hindsight gap",
    "",
    `Annualized returns on ${symbols.market}'s sessions: the universe equal-weighted and rebalanced daily, ${symbols.equalWeight} (equal-weight S&P 500) and ${symbols.market}.`,
    "",
    `| Window | Universe | ${symbols.equalWeight} | ${symbols.market} | Gap vs ${symbols.equalWeight} | Gap vs ${symbols.market} |`,
    "|---|---:|---:|---:|---:|---:|",
  );
  for (const [name, gap] of [
    ["Window", hindsight.main],
    ["Holdout", hindsight.holdout],
  ] as const) {
    const vsEw = gap.universe !== null && gap.equalWeight !== null ? gap.universe - gap.equalWeight : null;
    const vsMarket = gap.universe !== null && gap.market !== null ? gap.universe - gap.market : null;
    push(`| ${name} ${gap.from} to ${gap.to} | ${pct(gap.universe, 1, false)} | ${pct(gap.equalWeight, 1, false)} | ${pct(gap.market, 1, false)} | ${pct(vsEw, 1)} | ${pct(vsMarket, 1)} |`);
  }

  const counts = Object.entries(evaluation.data.fingerprint).filter(([symbol]) => symbol !== symbols.market && symbol !== symbols.equalWeight);
  const lastDates = [...new Set(counts.map(([, [, last]]) => last))].filter((d): d is string => d !== null).sort();
  const short = counts.filter(([, [n]]) => n < Math.max(...counts.map(([, [m]]) => m))).map(([symbol, [n]]) => `${symbol} (${n})`);
  push(
    "",
    "## Method notes",
    "",
    "- Rank IC: on each date, the Spearman correlation between the score and the forward return across stocks; the mean over all dates is tested with a Newey-West t " +
      "(Bartlett kernel, lag h, because h-session returns overlap). Every h-th date gives a non-overlapping grid, one per starting phase; the range of their classical t " +
      "shows how much a single grid could mislead, and the verdict is flagged fragile when the grids disagree.",
    "- A relationship counts as reliable when |t| >= 2. The label table overlaps heavily, so read it through its intervals, dates and episodes.",
    "- Selection, timing and the shares average over observations, so every stock-session counts once and days with many readings weigh more; " +
      "an average of per-date means would weigh every date equally instead. The bootstrap resamples whole dates either way.",
    `- The per-stock backtest behind each quote page reports a circular-shift permutation p-value per hold period (lib/signal.ts), because across ${evaluation.universe} stocks some edges look large by chance.`,
    "",
    "## Caveats",
    "",
    "- Survivorship and selection: the universe is today's large caps; the hindsight gap above measures how much that flatters returns.",
    "- One market: a strong US bull market with a few sharp sell-offs. Short-term reversal effects in large caps come and go with volatility.",
    "- Before costs, no slippage. The technical score only: fundamentals have no point-in-time history here.",
    "",
    "## Data",
    "",
    `Yahoo daily charts via yahoo-finance2, from ${symbols.dataFrom} (the earlier bars warm up the score) to ${evaluation.period.to}. ` +
      `${counts.length} stocks plus ${symbols.market} and ${symbols.equalWeight}; last bar ${lastDates.join(", ") || "n/a"}. ` +
      `${short.length > 0 ? `Shorter histories: ${short.join(", ")}. ` : ""}${evaluation.data.missing.length > 0 ? `No data: ${evaluation.data.missing.join(", ")}. ` : ""}` +
      `The bar count and last date of every symbol are in lib/signal-evaluation.json (data.fingerprint), and data.hash (${evaluation.data.hash}) identifies the exact bars. ` +
      "Yahoo recomputes adjusted closes in single precision on every request, so no two downloads are identical: one can flip a reading or a return sign near a cut-off. " +
      "In one comparison of two downloads the rare readings' hit rates moved by up to 0.15 points and their interval bounds by up to 0.25 points, t-statistics by less than 0.001 and ICs by about 0.00001. " +
      "The cached bars reproduce every number exactly.",
    "",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Rounds every non-integer to 5 decimals so the committed JSON stays small and its diffs readable. */
export function roundReplacer(_key: string, value: unknown): unknown {
  return typeof value === "number" && !Number.isInteger(value) ? Number(value.toFixed(5)) : value;
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const config = readConfig(arg("config", DEFAULT_CONFIG_PATH));
  const cacheDir = arg("cache", DEFAULT_CACHE_DIR);
  const offline = process.argv.includes("--offline");
  const allowPartial = process.argv.includes("--allow-partial");
  const outPath = arg("out", "docs/evaluation.md");
  const jsonPath = arg("json", "lib/signal-evaluation.json");
  const benchmarks = { market: config.data.market, equalWeight: config.data.equalWeight, dataFrom: config.data.from };

  console.log(`${offline ? "Reading" : "Downloading"} daily bars from ${config.data.from} (cache: ${cacheDir})`);
  const bars = await loadBars({ symbols: [...UNIVERSE_STOCKS, benchmarks.market, benchmarks.equalWeight], from: config.data.from, cacheDir, offline, allowPartial });
  const stocks = Object.fromEntries(UNIVERSE_STOCKS.map((symbol) => [symbol, bars[symbol] ?? []]));
  if (Object.values(stocks).every((series) => series.length === 0)) {
    throw new Error(`No bars for any universe stock in ${cacheDir}${offline ? " (run without --offline to download them)" : ""}.`);
  }
  checkCoverage(bars, [...UNIVERSE_STOCKS, benchmarks.equalWeight], benchmarks.market, config.signal.main.to, allowPartial);

  const evaluation = evaluateSignalModel({
    config: config.signal,
    bars: stocks,
    market: { symbol: benchmarks.market, bars: bars[benchmarks.market] ?? [] },
    equalWeight: { symbol: benchmarks.equalWeight, bars: bars[benchmarks.equalWeight] ?? [] },
  });
  if (evaluation.model.version !== MODEL_VERSION || evaluation.model.weights.momentum !== FACTOR_WEIGHTS.momentum || evaluation.model.thresholds.bullish !== SIGNAL_THRESHOLDS.bullish) {
    throw new Error("The evaluation does not describe the current model.");
  }

  // The report is rendered from the rounded evaluation, the numbers the app reads, so both round the same way.
  const rounded = JSON.parse(JSON.stringify(evaluation, roundReplacer)) as SignalEvaluation;
  writeFileSync(outPath, renderEvaluationReport(rounded, config.signal, benchmarks));
  writeFileSync(jsonPath, `${JSON.stringify(rounded, null, 2)}\n`);
  console.log(`Wrote ${outPath} and ${jsonPath} (${evaluation.observations} observations, ${evaluation.universe} stocks).`);
}

// Runs only as a script: npm run research imports the loaders above without starting an evaluation.
if (/evaluate-signal\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
