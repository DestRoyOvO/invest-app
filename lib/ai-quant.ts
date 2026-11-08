// Quant facts for the AI stock context: the short-term relative strength reading (descriptive), the evidence about it
// (lib/signal-evaluation.json), the risk forecast with its measured calibration (lib/risk-calibration.json), the style
// factor percentiles with their tested evidence (lib/factor-research.json) and the per-hold backtest with its
// permutation p-value. Server side only: the research JSON files must stay out of client bundles.
//
// None of the return signals passed the pre-registered tests, so everything directional is worded as a description.
// The risk forecast is the part with measured calibration and is reported with its coverage.

import { evaluationVerdict, findHorizon, findLabel, type FactorResearch, type RiskCalibration, type SignalEvaluation } from "@/lib/evaluation";
import { EVALUATION_DAYS, SIGNAL_EVALUATION } from "@/lib/evaluation-data";
import factorResearchData from "@/lib/factor-research.json";
import riskCalibrationData from "@/lib/risk-calibration.json";
import { labelForScore, SIGNAL_THRESHOLDS } from "@/lib/signal";
import type { FactorProfile, SignalCode, SignalReport, StyleFactorKey } from "@/types/api";

import { cleanInline, fmtMultiple, fmtNumber, fmtPrice, fmtRatio, isFiniteNumber, NA, ordinal } from "./ai-format";
import type { AssetClass } from "./ai-notes";

export const FACTOR_RESEARCH = factorResearchData as unknown as FactorResearch;
export const RISK_CALIBRATION = riskCalibrationData as unknown as RiskCalibration;

/** p-values at or above this make a backtest edge indistinguishable from random timing (three holds are tested). */
export const RANDOM_TIMING_P = 0.01;
/** The factor study's middle horizon, in sessions, quoted next to each percentile. */
const FACTOR_EVIDENCE_DAYS = 21;

/** Plain-language names of the readings: they describe recent relative strength, they are not forecasts. */
export const READING: Record<SignalCode, string> = {
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

/**
 * One line from the offline universe evaluation (lib/signal-evaluation.json): the rank IC with its Newey-West t, the
 * extreme readings' return against the same-day universe (market moves removed) with their bootstrap intervals and
 * episode counts, and the holdout decade with the caveat that model v4 dropped a factor after seeing it.
 */
export function evaluationLine(evaluation: SignalEvaluation = SIGNAL_EVALUATION): string | null {
  const horizon = findHorizon(evaluation, EVALUATION_DAYS);
  if (!horizon) return null;
  const days = horizon.days;
  const after = (label: ReturnType<typeof findLabel>) => {
    if (!label) return NA;
    const ci = label.ci.selection;
    return `${fmtRatio(label.selection, 2, true)} (95% CI ${ci ? `${fmtRatio(ci[0], 2, true)} to ${fmtRatio(ci[1], 2, true)}` : NA}, ${label.episodes} episodes)`;
  };
  const { holdout } = evaluation;
  const passed = holdout.factors.filter((factor) => factor.pass).map((factor) => factor.key);
  const holdoutCi = holdout.composite.ci ? `${fmtNumber(holdout.composite.ci[0], 3)} to ${fmtNumber(holdout.composite.ci[1], 3)}` : NA;
  // No weight was fitted to the holdout, but a factor dropped after seeing it makes it a weaker test of the current model.
  const weights = evaluation.model.weights;
  const names: Record<keyof typeof weights, string> = {
    momentum: "momentum",
    trend: "trend",
    rsi: "RSI",
    volume: "volume",
    value: "valuation",
    quality: "quality",
    volatility: "volatility regime",
  };
  const dropped = (Object.keys(names) as Array<keyof typeof weights>).filter((key) => weights[key] === 0).map((key) => names[key]);
  const holdoutUse =
    dropped.length === 0
      ? "the weights were never fitted to it"
      : `the weights were never fitted to it, but model v${evaluation.model.version} dropped the ${dropped.join(" and ")} after seeing it`;
  return (
    `- universe evaluation (${evaluation.universe} large US stocks, technical score, signals ${evaluation.from} to ${evaluation.to}): ` +
    `rank IC with ${days}-day forward returns ${fmtNumber(horizon.ic.mean, 3)} (Newey-West t ${fmtNumber(horizon.ic.t, 2)}), so ${EVALUATION_VERDICT_TEXT[evaluationVerdict(horizon)]}; ` +
    `average ${days}-day return against the same-day universe after very strong readings ${after(findLabel(horizon, "strong_bullish"))}, ` +
    `after very weak readings ${after(findLabel(horizon, "strong_bearish"))}; ` +
    `holdout ${holdout.from} to ${holdout.to} (${holdoutUse}): rank IC ${fmtNumber(holdout.composite.mean, 3)} (95% CI ${holdoutCi}), ` +
    (passed.length === 0 ? "and no technical factor passed its pre-set test" : `pre-set test passed by: ${passed.join(", ")}`)
  );
}

/** How far the hand-picked universe beat broad benchmarks over the evaluation window: a gauge of hindsight. */
export function hindsightLine(evaluation: SignalEvaluation = SIGNAL_EVALUATION): string | null {
  const gap = evaluation.hindsight?.main;
  if (!gap || !isFiniteNumber(gap.universe) || !isFiniteNumber(gap.equalWeight)) return null;
  const market = isFiniteNumber(gap.market) ? ` and ${fmtRatio(gap.market)} for SPY` : "";
  return `- hindsight: the ${evaluation.universe} stocks were chosen recently; from ${gap.from} to ${gap.to} they returned ${fmtRatio(gap.universe)} a year against ${fmtRatio(gap.equalWeight)} for the equal-weight S&P 500 (RSP)${market}, so look-back results on them flatter any rule`;
}

const QUINTILE_NAMES = ["lowest", "second lowest", "middle", "second highest", "highest"] as const;

/** Universe volatility quintile (1..5) of a 63-session volatility from the latest calibration breakpoints. */
export function volatilityQuintile(volatility63: number, calibration: RiskCalibration = RISK_CALIBRATION): number | null {
  const bounds = calibration.quintiles.breakpoints.latest?.values ?? calibration.quintiles.breakpoints.median;
  if (!isFiniteNumber(volatility63) || bounds.length !== 4) return null;
  return 1 + bounds.filter((bound) => volatility63 > bound).length;
}

/**
 * The risk forecast with its coverage as measured on the stock universe, and for stocks (`stockGroups`) the universe
 * volatility group with its drawdown history; the groups and their history say nothing about a fund or a coin.
 */
export function riskForecastLines(risk: SignalReport["risk"], calibration: RiskCalibration = RISK_CALIBRATION, stockGroups = true): string[] {
  if (!risk) return ["- risk forecast: not available (too little price history)"];
  const lines: string[] = [];
  const parts: string[] = [];
  if (risk.range1 && risk.range2 && isFiniteNumber(risk.price)) {
    const coverage = calibration.bands.overall;
    const measured =
      isFiniteNumber(coverage.within1) && isFiniteNumber(coverage.within2) && calibration.bands.horizon === risk.horizonDays
        ? `; in tests on large US stocks over ${calibration.window.from.slice(0, 4)}-${calibration.window.to.slice(0, 4)}, ${fmtRatio(coverage.within1)} of ${risk.horizonDays}-session moves stayed inside the first range and ${fmtRatio(coverage.within2)} inside the second`
        : "";
    parts.push(
      `next ${risk.horizonDays} sessions ${fmtPrice(risk.range1.low)}-${fmtPrice(risk.range1.high)} (plus or minus one standard deviation) and ${fmtPrice(risk.range2.low)}-${fmtPrice(risk.range2.high)} (two) around the last close ${fmtPrice(risk.price)}${measured}`,
    );
  }
  if (isFiniteNumber(risk.forecastVolatility)) parts.push(`forecast volatility ${fmtRatio(risk.forecastVolatility)} a year`);
  if (isFiniteNumber(risk.ownPercentile)) parts.push(`current 20-session volatility at the ${ordinal(risk.ownPercentile)} percentile of its own past year`);
  if (isFiniteNumber(risk.beta)) parts.push(`beta to SPY ${fmtNumber(risk.beta)} (252 sessions)`);
  lines.push(parts.length > 0 ? `- risk forecast (a range, not a direction): ${parts.join("; ")}` : "- risk forecast: not available");

  if (isFiniteNumber(risk.volatility63)) {
    const quintile = stockGroups ? volatilityQuintile(risk.volatility63, calibration) : null;
    const row = quintile ? calibration.quintiles.overall.find((r) => r.quintile === quintile) : undefined;
    const bounds = calibration.quintiles.breakpoints.latest;
    if (quintile && row && isFiniteNumber(row.drawdown)) {
      const boundaries = bounds ? ` (boundaries ${bounds.values.map((value) => fmtRatio(value)).join(", ")} on ${bounds.date})` : "";
      lines.push(
        `- 63-session volatility ${fmtRatio(risk.volatility63)}, in the ${QUINTILE_NAMES[quintile - 1]} of five universe volatility groups${boundaries}; in that group, ${fmtRatio(row.drawdown)} of stock-months from ${calibration.window.from.slice(0, 4)} to ${calibration.window.to.slice(0, 4)} saw a fall of ${fmtRatio(-calibration.quintiles.threshold, 0)} or more from a high within ${calibration.quintiles.horizon} sessions`,
      );
    } else {
      lines.push(`- 63-session volatility ${fmtRatio(risk.volatility63)}`);
    }
  }
  return lines;
}

const FACTOR_LABELS: Record<StyleFactorKey, { label: string; tested: string }> = {
  momentum: { label: "12-1 momentum", tested: "" },
  reversal: { label: "1-month return", tested: "tested as short-term reversal: " },
  high52: { label: "close vs 52-week high", tested: "" },
  volatility: { label: "63-session volatility", tested: "tested as low volatility: " },
  beta: { label: "252-session beta", tested: "tested as low beta: " },
};

const STYLE_FACTORS: readonly StyleFactorKey[] = ["momentum", "reversal", "high52", "volatility", "beta"];

/** Style factor percentiles with each factor's tested evidence in this universe. Null without a profile. */
export function factorLine(profile: FactorProfile | null, research: FactorResearch = FACTOR_RESEARCH): string | null {
  if (!profile) return null;
  const items = STYLE_FACTORS.flatMap((key) => {
    const percentile = profile.percentiles[key];
    if (!isFiniteNumber(percentile)) return [];
    const result = research.factors.find((factor) => factor.key === key)?.results.find((r) => r.days === FACTOR_EVIDENCE_DAYS);
    const { label, tested } = FACTOR_LABELS[key];
    const evidence =
      result && isFiniteNumber(result.ic) ? ` (${tested}IC ${result.ic > 0 ? "+" : ""}${fmtNumber(result.ic, 3)}, t ${fmtNumber(result.t, 2)}, Holm p ${fmtNumber(result.holmP, 2)})` : "";
    return [`${label} ${Math.round(percentile)}${evidence}`];
  });
  if (items.length === 0) return null;
  const anyPredictive = research.factors.some((factor) => factor.results.some((r) => r.verdict === "predictive"));
  const verdict = anyPredictive ? "check each factor's test" : "none predicted returns in the pre-registered test, so they are descriptive";
  const scope = profile.inUniverse ? `among ${profile.universeSize} large caps` : `against ${profile.universeSize} large caps (${profile.symbol} is not one of them)`;
  return `- style factor percentiles ${scope} (percentile of the raw value, 0-100; ${verdict}; evidence at ${FACTOR_EVIDENCE_DAYS} sessions): ${items.join("; ")}`;
}

function factorValue(raw: number | null, unit: SignalReport["factors"][number]["rawUnit"]): string {
  if (!isFiniteNumber(raw)) return "";
  if (unit === "percent") return ` (${fmtRatio(raw)})`;
  if (unit === "multiple") return ` (${fmtMultiple(raw)})`;
  return ` (${fmtNumber(raw, 1)})`;
}

/** Each hold period of the one-year backtest with its permutation p-value; edges with p >= 0.01 read as random timing. */
export function backtestLine(report: SignalReport): string {
  const backtest = report.backtest;
  if (!backtest || backtest.results.length === 0) return "- backtest: not available";
  const holds = backtest.results.map((result) => {
    const sample = result.lowSample ? ", fewer than 20 trades" : "";
    let timing = "no permutation test";
    if (isFiniteNumber(result.pValue)) {
      timing = result.pValue < RANDOM_TIMING_P ? `p ${fmtNumber(result.pValue, 3)}, unlikely from random timing` : `p ${fmtNumber(result.pValue, 2)}, indistinguishable from random timing`;
    }
    return `${result.holdDays}-session hold ${result.trades} trades, edge ${fmtRatio(result.edge, 2, true)} against holding every session (${timing}${sample})`;
  });
  return `- one-year backtest of strong readings (technical score >= ${SIGNAL_THRESHOLDS.bullish}, technical factors only, ${backtest.costBps} bps round trip): ${holds.join("; ")}`;
}

export interface QuantInput {
  report: SignalReport | null;
  profile: FactorProfile | null;
  /** The statistics measured on the stock universe (evaluation, volatility groups, factors) are for equities only. */
  asset?: AssetClass;
  evaluation?: SignalEvaluation;
  research?: FactorResearch;
  calibration?: RiskCalibration;
}

const ASSET_PLURALS: Record<Exclude<AssetClass, "equity">, string> = {
  fund: "funds",
  crypto: "cryptocurrencies",
  futures: "futures",
  currency: "currencies",
  index: "indices",
};

/** The quant facts block of the stock context. */
export function quantBlock({ report, profile, asset = "equity", evaluation = SIGNAL_EVALUATION, research = FACTOR_RESEARCH, calibration = RISK_CALIBRATION }: QuantInput): string {
  const stock = asset === "equity";
  if (!report) {
    const factors = stock ? factorLine(profile, research) : null;
    return factors ? `InvestSeek quant facts: model signal not available.\n${factors}` : "InvestSeek quant facts: not available.";
  }
  if (report.status !== "ok" || report.code === null) {
    const reason = cleanInline(report.reason, 120);
    return `InvestSeek quant facts: insufficient data${reason ? ` (${reason})` : ""}.`;
  }
  const lines = [`InvestSeek quant facts (model v${evaluation.model.version}; they describe ${stock ? "the stock" : "this instrument"}, none of them is a forecast of returns):`];
  if (isFiniteNumber(report.technicalScore)) {
    // Every input comes from the symbol's own price and volume history; the score is not a rank against other stocks.
    lines.push(
      `- short-term relative strength (the technical score, 0-100, from its own recent momentum, trend, RSI and volume; not a rank against other stocks): ${report.technicalScore.toFixed(1)}, reads ${READING[labelForScore(report.technicalScore)]}`,
    );
  }
  // Factors without weight (the volatility regime in v4) describe risk, which the risk forecast covers.
  const informative = [...report.factors.filter((factor) => !factor.imputed && factor.weight > 0)].sort((a, b) => b.score - a.score);
  const describe = (factor: SignalReport["factors"][number]) => `${factor.key} ${Math.round(factor.score)}${factorValue(factor.raw, factor.rawUnit)}`;
  if (informative.length >= 4) {
    lines.push(`- factor readings (0-100, higher reads stronger): strongest ${informative.slice(0, 2).map(describe).join(", ")}; weakest ${informative.slice(-2).reverse().map(describe).join(", ")}`);
  } else if (informative.length > 0) {
    lines.push(`- factor readings (0-100, higher reads stronger): ${informative.map(describe).join(", ")}`);
  }
  if (stock) {
    const evidence = evaluationLine(evaluation);
    if (evidence) lines.push(evidence);
    const hindsight = hindsightLine(evaluation);
    if (hindsight) lines.push(hindsight);
  } else {
    lines.push(`- evidence: the score and the risk ranges were tested on large US stocks only; there is no tested evidence for them on ${ASSET_PLURALS[asset]}`);
  }
  lines.push(...riskForecastLines(report.risk, calibration, stock));
  const factors = stock ? factorLine(profile, research) : null;
  if (factors) lines.push(factors);
  lines.push(backtestLine(report));
  lines.push(
    "- limits: the score mixes technical and fundamental factors, but only the technical part can be backtested because historical fundamentals are not available; past results do not predict future returns",
  );
  return lines.join("\n");
}
