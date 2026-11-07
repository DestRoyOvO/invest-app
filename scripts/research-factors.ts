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
 * docs/factor-research.md. The statistics live in lib/research.ts (pure, tested); this file only loads bars, renders
 * the report and writes the files. Bars come from the same cache as npm run evaluate, so --offline needs no network.
 *
 * Without --offline the bars are downloaded again. To refresh every published number from one download, run
 * `npm run evaluate` and then `npm run research -- --offline`; the three JSON files then carry the same data hash.
 * Failed downloads and stale symbols stop the run unless --allow-partial, as in npm run evaluate.
 *
 * Usage: npm run research -- [--offline] [--cache <dir>] [--allow-partial] [--config scripts/evaluation.config.json]
 *                            [--out docs/factor-research.md] [--factors lib/factor-research.json] [--risk lib/risk-calibration.json]
 */

import { writeFileSync } from "node:fs";

import type { FactorResearch, ResearchFactor, RiskCalibration } from "../lib/evaluation";
import { runResearch } from "../lib/research";
import { SECTORS, UNIVERSE_STOCKS } from "../lib/universe";

import { checkCoverage, DEFAULT_CACHE_DIR, DEFAULT_CONFIG_PATH, loadBars, readConfig, roundReplacer } from "./evaluate-signal";

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

/** Typical monthly rank IC of published large-cap factors after publication decay, the yardstick for power. */
const TYPICAL_FACTOR_IC = 0.03;

/**
 * docs/factor-research.md from the two result objects (as written to the JSON files, so the numbers match what the
 * app reads) and the study settings. Every conclusion in the text is checked against the results it describes.
 */
export function renderResearchReport(research: FactorResearch, risk: RiskCalibration, settings: { minStocksPerDate: number }): string {
  const lines: string[] = [];
  const push = (...rows: string[]) => lines.push(...rows);
  const periods = research.subperiods.map((p) => `${p.from.slice(0, 4)}-${p.to.slice(0, 4)}`);
  const all = research.factors.flatMap((f) => f.results.map((r) => ({ key: f.key, ...r })));
  const predictive = all.filter((r) => r.verdict === "predictive");
  const best = [...all].sort((a, b) => (a.p ?? 1) - (b.p ?? 1))[0];
  const [main, ...gaps] = research.bias.universeVsBenchmarks;
  const { market, equalWeight } = research.bias.benchmarks;
  const q = risk.quintiles.overall;

  // Low volatility and low beta: against their literature direction on raw returns, for it once beta is netted out?
  const lowRisk = research.factors.filter((f) => f.key === "volatility" || f.key === "beta");
  const lowRiskRaw = lowRisk.flatMap((f) => f.results.map((r) => r.ic));
  const lowRiskAdjusted = lowRisk.flatMap((f) => f.results.map((r) => r.betaAdjustedIc));
  const lowRiskIsBeta =
    lowRiskRaw.every((ic) => ic !== null && ic < 0) && lowRiskAdjusted.every((ic) => ic !== null && ic > 0 && ic < TYPICAL_FACTOR_IC * 2);
  const icsByFactor = (pick: (r: FactorResearch["factors"][number]["results"][number]) => number | null) =>
    lowRisk.map((f) => `${SHORT_LABEL[f.key].toLowerCase()} ${f.results.map((r) => num(pick(r))).join(" / ")}`).join(", ");
  // Power: can the design see a typical factor IC at all?
  const smallestDetectable = Math.min(...research.power.map((p) => p.minimumDetectableIc ?? Infinity));
  const underpowered = smallestDetectable > TYPICAL_FACTOR_IC;
  // Sampling noise of a per-date rank IC over n stocks is about 1 / sqrt(n - 1); above sqrt(2) times that, time variation dominates.
  const sdIcs = research.power.map((p) => p.sdIc).filter((sd): sd is number => sd !== null);
  const timeDominates = sdIcs.length > 0 && sdIcs.every((sd) => sd > Math.SQRT2 / Math.sqrt(research.universe - 1));
  // Hindsight: does the universe's lead shrink in every later subperiod, against both benchmarks?
  const lead = (g: (typeof gaps)[number], key: "equalWeight" | "market") => (g.universe !== null && g[key] !== null ? g.universe - (g[key] as number) : null);
  const shrinks = (key: "equalWeight" | "market") =>
    gaps.length > 1 && gaps.every((g, i) => lead(g, key) !== null && (i === 0 || (lead(g, key) as number) < (lead(gaps[i - 1], key) as number)));
  const riskPersists = (risk.persistence.volatility.mean ?? 0) >= 0.5 && (risk.persistence.volatility.min ?? 0) > 0;
  const monthCorrelation = research.bias.technicalVsMonthReturn;

  push(
    "# Factor research",
    "",
    "Generated by `npm run research` (scripts/research-factors.ts) from the settings in scripts/evaluation.config.json and the bar cache of `npm run evaluate`. " +
      "Re-running on the same bars reproduces this file, lib/factor-research.json and lib/risk-calibration.json exactly. " +
      `To refresh everything from one download, run \`npm run evaluate\` and then \`npm run research -- --offline\`: the data hash (${research.dataHash} here) then matches lib/signal-evaluation.json.`,
    "",
    "## Summary",
    "",
    predictive.length === 0
      ? `- **No factor passes the adoption rule.** Across ${all.length} pre-registered tests (${research.factors.length} factors x ${research.horizons.length} horizons, signals ${research.from} to ${research.to}, ${research.universe} large US stocks) ` +
          `the smallest p-value is ${num(best?.p ?? null, 3, false)} (${SHORT_LABEL[best.key]}, ${best.days} sessions, IC ${num(best.ic)}), and its Holm-adjusted p is ${num(best?.holmP ?? null, 2, false)}.`
      : `- Predictive under the rule: ${predictive.map((r) => `${SHORT_LABEL[r.key]} at ${r.days} sessions (IC ${num(r.ic)}, Holm p ${num(r.holmP, 3, false)})`).join("; ")}.`,
    lowRiskIsBeta
      ? `- Low volatility and low beta run against their literature direction on raw returns, but net of beta times ${market}'s return their ICs turn small and positive: ` +
          `the raw pattern is market exposure in a decade when ${market} returned ${pct(main.market)} a year, not stock selection.`
      : `- Low volatility and low beta, ICs at ${research.horizons.join(" / ")} sessions: ${icsByFactor((r) => r.ic)} on raw returns; net of beta times ${market}'s return ${icsByFactor((r) => r.betaAdjustedIc)}.`,
    `- The universe is today's leaders picked with hindsight: equal-weighted it returned ${pct(main.universe)} a year against ${pct(main.equalWeight)} for ${equalWeight} and ${pct(main.market)} for ${market}.`,
    `- With about ${research.universe} names the smallest IC this design can detect with 80% power is ${research.power.map((p) => `${num(p.minimumDetectableIc, 3, false)} at ${p.days}`).join(", ")} sessions` +
      (underpowered
        ? `, above typical large-cap factor ICs (about 0.01 to ${TYPICAL_FACTOR_IC}): the universe cannot validate a factor either way.`
        : `; typical large-cap factor ICs are about 0.01 to ${TYPICAL_FACTOR_IC}.`),
    `- ${riskPersists ? (predictive.length === 0 ? "Risk, unlike return, is forecastable" : "Risk is forecastable") : "Risk"}: trailing 63-session volatility ranks next quarter's volatility with a mean rank correlation of ${num(risk.persistence.volatility.mean, 2, false)} (never below ${num(risk.persistence.volatility.min, 2, false)}), ` +
      `trailing beta ranks next quarter's beta at ${num(risk.persistence.beta.mean, 2, false)}, and the volatility forecast's 10-session bands held ${pct(risk.bands.overall.within1)} and ${pct(risk.bands.overall.within2)} of moves (68.3% and 95.4% for normal returns).`,
    "",
    "## Design (fixed before the results)",
    "",
    `- Universe: the ${research.universe} stocks of lib/universe.ts with history; calendar: ${market}'s sessions. Signals every session from ${research.from}; a date counts with at least ${settings.minStocksPerDate} stocks.`,
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
    `Spread: highest minus lowest quintile of same-day excess returns per holding period (quintiles of ${Math.floor(research.universe / 5)} to ${Math.ceil(research.universe / 5)} stocks when all ${research.universe} have data). ` +
      "Robustness ICs use the same dates: ranks demeaned within " +
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
    `The technical score ${monthCorrelation !== null && monthCorrelation >= 0.5 ? "is mostly last month's relative move" : "follows last month's relative move only in part"}: ` +
      `its mean cross-sectional rank correlation with the trailing 21-session return is ${num(monthCorrelation, 2)}.`,
    "",
    "## Power",
    "",
    "Minimum detectable mean IC (two-sided 5% test, 80% power) from the median standard deviation of the per-date IC across the seven factors:",
    "",
    "| Horizon | Dates | IC standard deviation | Minimum detectable IC |",
    "|---:|---:|---:|---:|",
    ...research.power.map((p) => `| ${p.days} | ${p.dates} | ${num(p.sdIc, 3, false)} | ${num(p.minimumDetectableIc, 3, false)} |`),
    "",
    `Published large-cap factor ICs are about 0.01 to ${TYPICAL_FACTOR_IC} per month, so a null here means "cannot tell", not "disproven".` +
      (timeDominates
        ? ` The per-date IC varies mostly with time rather than with sampling noise (about ${num(1 / Math.sqrt(research.universe - 1), 2, false)} for ${research.universe} names), so more years help more than more names.`
        : ""),
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
    `${shrinks("equalWeight") && shrinks("market") ? "The gap shrinks toward the date the list was chosen. " : ""}Hindsight works against momentum too: the losers still in today's list are the ones that recovered.`,
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
    `- Hindsight universe: ${research.universe} of today's largest stocks, chosen in 2026. Delisted and shrunken companies are missing, which flatters returns and favours stocks that fell and recovered. ` +
      "A point-in-time universe (historical index membership) is the fix and is not available from Yahoo.",
    underpowered
      ? "- Power: with this few names and years, realistic factor ICs are below what the tests can detect. A null result here does not refute the published evidence."
      : "- Power: see the table above; a factor near the detection limit can still be missed.",
    "- Regime: one decade, mostly a strong US bull market. Low-risk and reversal effects are known to depend on the market's volatility.",
    "- Data: Yahoo daily charts, dividend and split adjusted; returns before costs; no fundamentals (they have no point-in-time history here). " +
      "Yahoo recomputes adjusted closes in single precision on every request, so no two downloads are identical; in one comparison a fresh download moved t-statistics and p-values " +
      "by less than 0.001 and ICs by about 0.00001. The cached bars reproduce every number exactly.",
    "- Intended use: lib/factor-research.json backs descriptive factor percentiles shown with their measured IC, never a buy or sell signal; " +
      "lib/risk-calibration.json backs the risk ranges with their measured coverage.",
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
  const allowPartial = process.argv.includes("--allow-partial");
  const { market, equalWeight } = config.data;
  console.log(`${offline ? "Reading" : "Downloading"} daily bars from ${config.data.from} (cache: ${cacheDir})`);
  const bars = await loadBars({ symbols: [...UNIVERSE_STOCKS, market, equalWeight], from: config.data.from, cacheDir, offline, allowPartial });
  for (const to of new Set([config.factors.window.to, config.risk.window.to])) checkCoverage(bars, [...UNIVERSE_STOCKS, equalWeight], market, to, allowPartial);

  const sectors = new Map(SECTORS.flatMap((sector) => sector.stocks.map((symbol) => [symbol, sector.key] as const)));
  const results = runResearch({ bars, symbols: UNIVERSE_STOCKS, sectors, benchmarks: { market, equalWeight }, factors: config.factors, risk: config.risk });
  // The report is rendered from the rounded results, the numbers the app reads, so both round the same way.
  const research = JSON.parse(JSON.stringify(results.research, roundReplacer)) as FactorResearch;
  const risk = JSON.parse(JSON.stringify(results.risk, roundReplacer)) as RiskCalibration;

  const outPath = arg("out", "docs/factor-research.md");
  const factorsPath = arg("factors", "lib/factor-research.json");
  const riskPath = arg("risk", "lib/risk-calibration.json");
  writeFileSync(outPath, renderResearchReport(research, risk, config.factors));
  writeFileSync(factorsPath, `${JSON.stringify(research, null, 2)}\n`);
  writeFileSync(riskPath, `${JSON.stringify(risk, null, 2)}\n`);
  console.log(`Wrote ${outPath}, ${factorsPath} and ${riskPath} (${research.universe} stocks, signals ${research.from} to ${research.to}).`);
}

// Runs only as a script, so tests and other scripts can import the report renderer without starting a run.
if (/research-factors\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
