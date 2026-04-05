// ═══════════════════════════════════════════════════════════════════════════════
// InvestSeek Quantitative Signal Engine v2
// 7-factor model with multi-timeframe analysis, volume confirmation,
// mean-reversion detection, and signal confidence scoring.
// All calculations are pure functions — same code path for live and backtest.
// ═══════════════════════════════════════════════════════════════════════════════

export interface DailyBar {
  date: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface Fundamentals {
  pe?: number | null;
  roe?: number | null;        // decimal, e.g. 0.25 = 25%
  profitMargin?: number | null; // decimal
  revenueGrowth?: number | null; // decimal YoY
  debtToEquity?: number | null;
}

export interface FactorScores {
  momentum: number;       // 0–100  multi-timeframe momentum
  trend: number;          // 0–100  MA alignment & positioning
  rsi: number;            // 0–100  mean-reversion (inverted: 100=not overbought)
  volume: number;         // 0–100  volume-price confirmation
  value: number;          // 0–100  valuation composite
  quality: number;        // 0–100  financial quality (ROE, margins)
  volatility: number;     // 0–100  risk-adjusted (lower vol = higher)
}

export type SignalLabel = 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell';

export interface SignalResult {
  signal: SignalLabel;
  score: number;
  confidence: number;
  factorAgreement: number;
  dataCompleteness: number;
  components: FactorScores;
  metadata: {
    ticker: string;
    computedAt: string;
    dataPoints: number;
    returnShort?: number;
    returnMed?: number;
    returnLong?: number;
    rsi14?: number;
    volatility20d?: number;
    pe?: number;
    roe?: number;
    volumeRatio?: number;
  };
}

export interface BacktestResult {
  winRate: number;
  avgReturn: number;
  maxReturn: number;
  minReturn: number;
  sharpe: number;
  maxDrawdown: number;
  sampleSize: number;
  holdingPeriod: number;
  totalSignals: number;       // all days evaluated
  buySignals: number;         // Buy + Strong Buy count
  sellSignals: number;        // Sell + Strong Sell count
}

// ─── Factor weights (tuned for balanced signal) ─────────────────────────────
const WEIGHTS = {
  momentum:   0.20,
  trend:      0.15,
  rsi:        0.10,
  volume:     0.10,
  value:      0.18,
  quality:    0.12,
  volatility: 0.15,
};

// ─── Helper: clamp and normalize ────────────────────────────────────────────
function normalize(value: number, min: number, max: number): number {
  const clamped = Math.max(min, Math.min(max, value));
  return Math.round(((clamped - min) / (max - min)) * 100);
}

function inverseNormalize(value: number, min: number, max: number): number {
  const clamped = Math.max(min, Math.min(max, value));
  return Math.round(((max - clamped) / (max - min)) * 100);
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 20-day stdev of simple daily returns (most recent window). */
function dailyReturnStd(bars: DailyBar[], window: number): number | undefined {
  if (bars.length < window + 1) return undefined;
  const rets: number[] = [];
  const start = bars.length - window;
  for (let i = start; i < bars.length; i++) {
    const a = bars[i - 1].close;
    const b = bars[i].close;
    if (a > 0) rets.push((b - a) / a);
  }
  if (rets.length < 5) return undefined;
  const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
  const v = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(rets.length - 1, 1);
  return Math.sqrt(v);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTOR 1: Multi-Timeframe Momentum (weight: 20%)
// Combines 5d, 20d, 60d returns. Short-term weighted more for responsiveness,
// but long-term required for confirmation to avoid whipsaws.
// ═══════════════════════════════════════════════════════════════════════════════
function periodReturn(bars: DailyBar[], period: number): number | undefined {
  if (bars.length < period + 1) return undefined;
  const current = bars[bars.length - 1].close;
  const past = bars[bars.length - 1 - period].close;
  return past > 0 ? (current - past) / past : undefined;
}

export function computeMomentum(bars: DailyBar[]): number {
  const r5 = periodReturn(bars, 5);
  const r20 = periodReturn(bars, 20);
  const r60 = periodReturn(bars, 60);

  if (r5 === undefined && r20 === undefined) return 50;

  // Vol-adjust: scale returns so high-vol names need larger moves to score extremes
  const dstd = dailyReturnStd(bars, 20);
  const ref = 0.012;
  const scale = ref / Math.max(dstd ?? ref, 0.006);
  const adj = (r: number | undefined) => (r === undefined ? undefined : r * scale);

  const ar5 = adj(r5);
  const ar20 = adj(r20);
  const ar60 = adj(r60);

  const s5 = ar5 !== undefined ? normalize(ar5, -0.15, 0.15) : 50;
  const s20 = ar20 !== undefined ? normalize(ar20, -0.20, 0.20) : 50;
  const s60 = ar60 !== undefined ? normalize(ar60, -0.30, 0.30) : 50;

  // Weighted: recent matters more but requires long-term confirmation
  // Mean-reversion penalty: if 5d is extremely positive but 60d is negative, dampen
  let score = s5 * 0.35 + s20 * 0.40 + s60 * 0.25;

  // Divergence penalty: only when short-term and long-term disagree in direction
  if (ar5 !== undefined && ar60 !== undefined) {
    const shortBullish = s5 >= 50;
    const longBullish = s60 >= 50;
    if (shortBullish !== longBullish) {
      const divergence = Math.abs(s5 - s60);
      score = score * (divergence > 50 ? 0.80 : divergence > 30 ? 0.90 : 1.0);
    }
  }

  return Math.round(Math.max(0, Math.min(100, score)));
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTOR 2: Trend Alignment (weight: 15%)
// Price position relative to MA20, MA50, MA100. Perfect bullish alignment
// (price > MA20 > MA50 > MA100) = 100. Full bearish = 0.
// ═══════════════════════════════════════════════════════════════════════════════
function sma(bars: DailyBar[], window: number): number | undefined {
  if (bars.length < window) return undefined;
  const slice = bars.slice(-window);
  return slice.reduce((s, b) => s + b.close, 0) / window;
}

export function computeTrend(bars: DailyBar[]): number {
  const price = bars[bars.length - 1]?.close;
  if (!price) return 50;

  const ma20 = sma(bars, 20);
  const ma50 = sma(bars, 50);
  const ma100 = sma(bars, 100);

  let points = 0;
  let maxPoints = 0;

  // Price above each MA: bullish
  if (ma20 !== undefined) { maxPoints += 2; if (price > ma20) points += 2; }
  if (ma50 !== undefined) { maxPoints += 2; if (price > ma50) points += 2; }
  if (ma100 !== undefined) { maxPoints += 2; if (price > ma100) points += 2; }

  // MA alignment: shorter MA above longer MA
  if (ma20 !== undefined && ma50 !== undefined) { maxPoints += 1.5; if (ma20 > ma50) points += 1.5; }
  if (ma50 !== undefined && ma100 !== undefined) { maxPoints += 1.5; if (ma50 > ma100) points += 1.5; }

  // Distance from MA20: momentum of trend (not too extended)
  if (ma20 !== undefined && ma20 > 0) {
    const distPct = (price - ma20) / ma20;
    // Mild positive distance is best. Too extended is risky.
    maxPoints += 1;
    if (distPct > 0 && distPct < 0.05) points += 1;      // healthy uptrend
    else if (distPct >= 0.05 && distPct < 0.10) points += 0.5; // extended
    else if (distPct >= -0.03 && distPct <= 0) points += 0.6;  // slight pullback in uptrend
  }

  if (maxPoints === 0) return 50;
  let score = (points / maxPoints) * 100;

  // MA20 slope (5 sessions): rewards persistent trend, penalizes rolling-over structure
  if (ma20 !== undefined && ma20 > 0 && bars.length >= 25) {
    const lagBars = bars.slice(0, bars.length - 5);
    const ma20Lag = sma(lagBars, 20);
    if (ma20Lag !== undefined && ma20Lag > 0) {
      const slope = (ma20 - ma20Lag) / ma20Lag;
      if (score >= 54 && slope > 0.001) {
        score = Math.min(100, score + Math.min(10, slope * 350));
      } else if (score <= 46 && slope < -0.001) {
        score = Math.max(0, score + Math.max(-10, slope * 350));
      }
    }
  }

  return Math.round(score);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTOR 3: RSI Mean-Reversion (weight: 10%)
// 14-day RSI. Score is INVERTED: RSI 30 (oversold) = high score (buying opportunity),
// RSI 70 (overbought) = low score (risk of pullback).
// ═══════════════════════════════════════════════════════════════════════════════
/** Wilder smoothing RSI(14) over full history (industry-standard). */
function computeRSI14(bars: DailyBar[]): number | undefined {
  if (bars.length < 15) return undefined;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= 14; i++) {
    const ch = bars[i].close - bars[i - 1].close;
    if (ch >= 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= 14;
  avgLoss /= 14;
  for (let i = 15; i < bars.length; i++) {
    const ch = bars[i].close - bars[i - 1].close;
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * 13 + g) / 14;
    avgLoss = (avgLoss * 13 + l) / 14;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function computeRSI(bars: DailyBar[]): number {
  const rsi = computeRSI14(bars);
  if (rsi === undefined) return 50;

  // Non-linear scoring: oversold (RSI < 30) is very bullish, overbought (RSI > 70) bearish
  // But extreme oversold (RSI < 15) could mean fundamental problems → slight penalty
  if (rsi <= 15) return 65;        // extreme oversold: bullish but cautious
  if (rsi <= 30) return 85;        // oversold: strong buy opportunity
  if (rsi <= 45) return 70;        // slightly below neutral: mild buy
  if (rsi <= 55) return 55;        // neutral zone
  if (rsi <= 70) return 40;        // slightly overbought: cautious
  if (rsi <= 85) return 20;        // overbought: sell pressure
  return 10;                       // extremely overbought
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTOR 4: Volume Dynamics (weight: 10%)
// Confirms price moves with volume. Rising price + rising volume = bullish.
// Rising price + falling volume = weak/suspect rally.
// ═══════════════════════════════════════════════════════════════════════════════
export function computeVolume(bars: DailyBar[]): number {
  if (bars.length < 25) return 50;

  const recent = bars.slice(-5);
  const baseline = bars.slice(-25, -5);

  const hasVolume = recent.every(b => b.volume !== undefined && b.volume > 0) &&
                    baseline.some(b => b.volume !== undefined && b.volume > 0);
  if (!hasVolume) return 50;

  const recentAvgVol = recent.reduce((s, b) => s + (b.volume || 0), 0) / recent.length;
  const baselineAvgVol = baseline.reduce((s, b) => s + (b.volume || 0), 0) / baseline.length;

  if (baselineAvgVol === 0) return 50;
  const recentMed = median(recent.map((b) => b.volume || 0));
  const baselineMed = median(baseline.map((b) => b.volume || 0));
  const volumeRatio = baselineMed > 0 ? recentMed / baselineMed : recentAvgVol / baselineAvgVol;

  // Price direction over same period
  const priceChange = (recent[recent.length - 1].close - recent[0].close) / recent[0].close;

  let score = 50;

  if (priceChange > 0.01) {
    // Price rising
    if (volumeRatio > 1.35) score = 85;       // strong volume confirmation
    else if (volumeRatio > 1.05) score = 70;  // moderate confirmation
    else if (volumeRatio > 0.75) score = 55;  // weak rally (volume declining)
    else score = 40;                          // very weak - distribution likely
  } else if (priceChange < -0.01) {
    // Price falling
    if (volumeRatio > 1.35) score = 20;       // heavy selling - capitulation
    else if (volumeRatio > 1.05) score = 35;  // confirmed downtrend
    else if (volumeRatio > 0.75) score = 50;  // gentle fade, may reverse
    else score = 60;                          // declining on low volume - could be drying up
  } else {
    // Flat price
    if (volumeRatio > 1.25) score = 45;       // accumulation or distribution
    else score = 50;                          // quiet/neutral
  }

  return score;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTOR 5: Enhanced Value (weight: 18%)
// Composite of P/E, PEG-like adjustment for growth stocks.
// ═══════════════════════════════════════════════════════════════════════════════
export function computeValue(fundamentals: Fundamentals): number {
  const { pe, revenueGrowth } = fundamentals;

  if (pe === undefined || pe === null) return 50; // no data = neutral

  // Negative P/E means negative earnings — penalize
  if (pe < 0) return 20;

  // P/E of 0 is nonsensical (likely bad data)
  if (pe === 0) return 50;

  // Growth-adjusted P/E thresholds
  let score: number;
  if (revenueGrowth !== undefined && revenueGrowth !== null && revenueGrowth > 0.15) {
    score = inverseNormalize(pe, 10, 80);
  } else if (revenueGrowth !== undefined && revenueGrowth !== null && revenueGrowth > 0.05) {
    score = inverseNormalize(pe, 8, 50);
  } else {
    score = inverseNormalize(pe, 5, 35);
  }

  // Value trap: ultra-low P/E with no/negative growth — cap optimism
  if (pe > 0 && pe < 7 && (revenueGrowth === undefined || revenueGrowth === null || revenueGrowth < 0)) {
    score = Math.min(score, 60);
  }

  return score;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTOR 6: Financial Quality (weight: 12%)
// ROE, profit margins, debt levels — measures business fundamentals
// ═══════════════════════════════════════════════════════════════════════════════
export function computeQuality(fundamentals: Fundamentals): number {
  const { roe, profitMargin, debtToEquity } = fundamentals;

  // Missing metrics default to 50 (neutral) so the score pulls toward center
  // when data is sparse, avoiding extreme ratings from a single metric.
  let roeScore = 50;
  let marginScore = 50;
  let debtScore = 50;

  if (roe !== undefined && roe !== null) {
    roeScore = normalize(roe, 0, 1.0);
  }

  if (profitMargin !== undefined && profitMargin !== null) {
    marginScore = normalize(profitMargin, -0.05, 0.5);
  }

  if (debtToEquity !== undefined && debtToEquity !== null) {
    debtScore = inverseNormalize(debtToEquity, 0, 3.0);
  }

  if (roe == null && profitMargin == null && debtToEquity == null) return 50;

  const allPresent =
    roe !== undefined && roe !== null &&
    profitMargin !== undefined && profitMargin !== null &&
    debtToEquity !== undefined && debtToEquity !== null;

  if (allPresent) {
    const avg = (roeScore + marginScore + debtScore) / 3;
    const weakest = Math.min(roeScore, marginScore, debtScore);
    return Math.round(weakest * 0.24 + avg * 0.76);
  }

  return Math.round((roeScore + marginScore + debtScore) / 3);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTOR 7: Volatility / Risk (weight: 15%)
// Downside-focused (Sortino-like): penalizes downside volatility more than upside.
// ═══════════════════════════════════════════════════════════════════════════════
export function computeVolatility(bars: DailyBar[]): number {
  if (bars.length < 21) return 50;
  const recent = bars.slice(-21);
  const logReturns: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1].close > 0 && recent[i].close > 0) {
      logReturns.push(Math.log(recent[i].close / recent[i - 1].close));
    }
  }
  if (logReturns.length < 10) return 50;

  // Separate upside and downside
  const downsideReturns = logReturns.filter(r => r < 0);
  const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
  const totalVariance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / (logReturns.length - 1);
  const annualizedVol = Math.sqrt(totalVariance) * Math.sqrt(252);

  // Downside deviation (Sortino-style)
  let downsideVariance = 0;
  if (downsideReturns.length > 2) {
    downsideVariance = downsideReturns.reduce((s, v) => s + v ** 2, 0) / downsideReturns.length;
  }
  const annualizedDownside = Math.sqrt(downsideVariance) * Math.sqrt(252);

  // Blend total vol and downside vol (70% downside, 30% total)
  const blendedVol = annualizedDownside * 0.7 + annualizedVol * 0.3;

  // Inverse normalize: low vol = high score
  return inverseNormalize(blendedVol, 0.08, 0.70);
}

export function rawVolatility(bars: DailyBar[]): number | undefined {
  if (bars.length < 21) return undefined;
  const recent = bars.slice(-21);
  const logReturns: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1].close > 0 && recent[i].close > 0) {
      logReturns.push(Math.log(recent[i].close / recent[i - 1].close));
    }
  }
  if (logReturns.length < 10) return undefined;
  const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
  const variance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / (logReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/** Strong trend + momentum: ease mean-reversion RSI so it does not dominate a healthy advance/decline. */
function applyRsiRegimeBlend(factors: FactorScores): FactorScores {
  const { trend, momentum, rsi } = factors;
  if (trend >= 72 && momentum >= 55) {
    return { ...factors, rsi: Math.round(rsi * 0.67 + 50 * 0.33) };
  }
  if (trend <= 28 && momentum <= 45) {
    return { ...factors, rsi: Math.round(rsi * 0.67 + 50 * 0.33) };
  }
  return factors;
}

/** Full factor pipeline (matches live signal and backtest per-bar evaluation). */
export function computeFactorScores(bars: DailyBar[], fundamentals: Fundamentals): FactorScores {
  const base: FactorScores = {
    momentum: computeMomentum(bars),
    trend: computeTrend(bars),
    rsi: computeRSI(bars),
    volume: computeVolume(bars),
    value: computeValue(fundamentals),
    quality: computeQuality(fundamentals),
    volatility: computeVolatility(bars),
  };
  return applyRsiRegimeBlend(base);
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSITE SCORE, SIGNAL LABEL, CONFIDENCE
// ═══════════════════════════════════════════════════════════════════════════════
export function compositeScore(factors: FactorScores): number {
  return Math.round(
    factors.momentum * WEIGHTS.momentum +
    factors.trend * WEIGHTS.trend +
    factors.rsi * WEIGHTS.rsi +
    factors.volume * WEIGHTS.volume +
    factors.value * WEIGHTS.value +
    factors.quality * WEIGHTS.quality +
    factors.volatility * WEIGHTS.volatility
  );
}

export function scoreToSignal(score: number): SignalLabel {
  if (score >= 72) return 'Strong Buy';
  if (score >= 58) return 'Buy';
  if (score >= 42) return 'Hold';
  if (score >= 28) return 'Sell';
  return 'Strong Sell';
}

/** Weighted directional agreement: factors aligned with composite direction, weighted by model importance. */
export function computeFactorAgreement(factors: FactorScores, overallScore: number): number {
  const isBullish = overallScore >= 50;
  const keys = Object.keys(WEIGHTS) as (keyof FactorScores)[];
  let agreeWeight = 0;
  for (const k of keys) {
    const v = factors[k];
    if (isBullish ? v >= 50 : v < 50) agreeWeight += WEIGHTS[k];
  }
  return Math.round(agreeWeight * 100);
}

/** Per-factor data presence (0–1); penalizes neutral imputation from missing Yahoo fields or short history. */
export function computeDataCompleteness(bars: DailyBar[], fundamentals: Fundamentals): number {
  const r5 = periodReturn(bars, 5);
  const r20 = periodReturn(bars, 20);
  const r60 = periodReturn(bars, 60);
  const retSlots = [r5, r20, r60].filter((x) => x !== undefined).length;
  const momentumFrac = retSlots / 3;

  let trendFrac = 0;
  if (bars.length >= 100) trendFrac = 1;
  else if (bars.length >= 50) trendFrac = 0.75;
  else if (bars.length >= 20) trendFrac = 0.5;
  else if (bars.length >= 1) trendFrac = 0.25;

  const rsiFrac = bars.length >= 15 ? 1 : 0;

  let volFrac = 0;
  if (bars.length >= 25) {
    const recent = bars.slice(-5);
    const baseline = bars.slice(-25, -5);
    const hasVolume =
      recent.every((b) => b.volume !== undefined && b.volume > 0) &&
      baseline.some((b) => b.volume !== undefined && b.volume > 0);
    volFrac = hasVolume ? 1 : 0;
  }

  const { pe, roe, profitMargin, debtToEquity } = fundamentals;
  const valueFrac = pe !== undefined && pe !== null ? 1 : 0;

  let qualCount = 0;
  if (roe !== undefined && roe !== null) qualCount++;
  if (profitMargin !== undefined && profitMargin !== null) qualCount++;
  if (debtToEquity !== undefined && debtToEquity !== null) qualCount++;
  const qualityFrac = qualCount / 3;

  let volRiskFrac = 0;
  if (bars.length >= 21) {
    const recent = bars.slice(-21);
    let n = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i - 1].close > 0 && recent[i].close > 0) n++;
    }
    volRiskFrac = n >= 10 ? 1 : 0;
  }

  const sum =
    momentumFrac +
    trendFrac +
    rsiFrac +
    volFrac +
    valueFrac +
    qualityFrac +
    volRiskFrac;
  return Math.round((sum / 7) * 100);
}

/** Combine agreement and data coverage (both must be high for a strong headline confidence). */
export function computeReliability(factorAgreement: number, dataCompleteness: number): number {
  const a = Math.max(0, Math.min(100, factorAgreement));
  const d = Math.max(0, Math.min(100, dataCompleteness));
  // Geometric mean on 0–100 scale: √(a·d). (Using √(a·d/100) was a bug — e.g. 80 & 100 became ~9%.)
  return Math.round(Math.sqrt(a * d));
}

/** @deprecated Use computeFactorAgreement + computeReliability for clarity */
export function computeConfidence(factors: FactorScores, overallScore: number): number {
  return computeFactorAgreement(factors, overallScore);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL SIGNAL COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════════
export function computeSignal(
  ticker: string,
  bars: DailyBar[],
  fundamentals: Fundamentals,
): SignalResult {
  const factors = computeFactorScores(bars, fundamentals);

  const score = compositeScore(factors);
  const factorAgreement = computeFactorAgreement(factors, score);
  const dataCompleteness = computeDataCompleteness(bars, fundamentals);
  const confidence = computeReliability(factorAgreement, dataCompleteness);

  const recentVols = bars.slice(-5);
  const baselineVols = bars.slice(-25, -5);
  const recentAvgVol = recentVols.length > 0 ? recentVols.reduce((s, b) => s + (b.volume || 0), 0) / recentVols.length : 0;
  const baselineAvgVol = baselineVols.length > 0 ? baselineVols.reduce((s, b) => s + (b.volume || 0), 0) / baselineVols.length : 0;

  return {
    signal: scoreToSignal(score),
    score,
    confidence,
    factorAgreement,
    dataCompleteness,
    components: factors,
    metadata: {
      ticker,
      computedAt: new Date().toISOString(),
      dataPoints: bars.length,
      returnShort: periodReturn(bars, 5),
      returnMed: periodReturn(bars, 20),
      returnLong: periodReturn(bars, 60),
      rsi14: computeRSI14(bars),
      volatility20d: rawVolatility(bars),
      pe: fundamentals.pe ?? undefined,
      roe: fundamentals.roe ?? undefined,
      volumeRatio: baselineAvgVol > 0 ? recentAvgVol / baselineAvgVol : undefined,
    },
  };
}

// For backtest: compute signal using only bars up to index, with fixed fundamentals
export function computeSignalAtIndex(
  bars: DailyBar[],
  endIndex: number,
  fundamentals: Fundamentals,
): { score: number; signal: SignalLabel } {
  const windowBars = bars.slice(0, endIndex + 1);
  const factors = computeFactorScores(windowBars, fundamentals);
  const score = compositeScore(factors);
  return { score, signal: scoreToSignal(score) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENHANCED BACKTEST
// Tests Buy/Strong Buy signals; reports Sharpe ratio, max drawdown, etc.
// ═══════════════════════════════════════════════════════════════════════════════
export function backtest(
  bars: DailyBar[],
  fundamentals: Fundamentals,
  backtestDays: number = 60,
  holdDays: number = 5,
): BacktestResult | null {
  const lookback = 100;
  const minBars = lookback + backtestDays + holdDays;
  if (bars.length < minBars) return null;

  const endIdx = bars.length - holdDays - 1;
  const startIdx = endIdx - backtestDays + 1;
  if (startIdx < lookback) return null;

  // Single pass: compute signal once per day, count totals, simulate non-overlapping trades
  let totalBuySignals = 0;
  let totalSellSignals = 0;
  let wins = 0;
  let maxReturn = -Infinity;
  let minReturn = Infinity;
  const returns: number[] = [];
  let holdUntil = -1; // when in a position, skip new entries until this index

  for (let i = startIdx; i <= endIdx; i++) {
    const { signal } = computeSignalAtIndex(bars, i, fundamentals);
    const isBuy = signal === 'Buy' || signal === 'Strong Buy';
    const isSell = signal === 'Sell' || signal === 'Strong Sell';

    if (isBuy) totalBuySignals++;
    else if (isSell) totalSellSignals++;

    // Only open a new trade if not currently holding
    if (isBuy && i >= holdUntil) {
      const entryPrice = bars[i].close;
      const exitPrice = bars[i + holdDays].close;
      const ret = (exitPrice - entryPrice) / entryPrice;
      returns.push(ret);
      if (ret > 0) wins++;
      maxReturn = Math.max(maxReturn, ret);
      minReturn = Math.min(minReturn, ret);
      holdUntil = i + holdDays;
    }
  }

  const sampleSize = returns.length;

  if (sampleSize === 0) {
    return {
      winRate: 0, avgReturn: 0, maxReturn: 0, minReturn: 0,
      sharpe: 0, maxDrawdown: 0, sampleSize: 0, holdingPeriod: holdDays,
      totalSignals: backtestDays, buySignals: totalBuySignals, sellSignals: totalSellSignals,
    };
  }

  const avgReturn = returns.reduce((s, r) => s + r, 0) / sampleSize;

  // Sharpe: mean / std of per-trade returns
  const variance = returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (sampleSize - 1 || 1);
  const stdRet = Math.sqrt(variance);
  const sharpe = stdRet > 0 ? avgReturn / stdRet : 0;

  // Max drawdown: geometric compounding of equity curve, then peak-to-trough
  let equity = 1.0;
  let peak = 1.0;
  let maxDrawdown = 0;
  for (const r of returns) {
    equity *= (1 + r);
    peak = Math.max(peak, equity);
    const dd = (equity - peak) / peak; // percentage drawdown from peak
    maxDrawdown = Math.min(maxDrawdown, dd);
  }

  return {
    winRate: wins / sampleSize,
    avgReturn,
    maxReturn,
    minReturn,
    sharpe: Math.round(sharpe * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 10000,
    sampleSize,
    holdingPeriod: holdDays,
    totalSignals: backtestDays,
    buySignals: totalBuySignals,
    sellSignals: totalSellSignals,
  };
}
