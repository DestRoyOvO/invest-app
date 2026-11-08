import { describe, expect, it } from "vitest";

import type { FactorProfile, SignalReport } from "@/types/api";

import { backtestLine, factorLine, FACTOR_RESEARCH, hindsightLine, quantBlock, RISK_CALIBRATION, riskForecastLines, volatilityQuintile } from "./ai-quant";

const REPORT: SignalReport = {
  symbol: "NVDA",
  asOf: "2026-11-07T15:00:00.000Z",
  status: "ok",
  code: "bullish",
  score: 63.6,
  technicalScore: 41.2,
  consensus: 58,
  coverage: 100,
  confidence: "medium",
  factors: [
    { key: "momentum", group: "technical", score: 78, weight: 0.24, imputed: false, raw: 0.12, rawUnit: "percent" },
    { key: "trend", group: "technical", score: 70, weight: 0.18, imputed: false, raw: null, rawUnit: null },
    { key: "value", group: "fundamental", score: 32, weight: 0.21, imputed: false, raw: 54.2, rawUnit: "multiple" },
    { key: "rsi", group: "technical", score: 45, weight: 0.12, imputed: false, raw: 61.3, rawUnit: "number" },
  ],
  backtest: {
    technicalOnly: true,
    costBps: 10,
    results: [
      { holdDays: 3, windowDays: 250, trades: 36, winRate: 0.58, winRateCI: [0.408, 0.737], avgReturn: 0.009, baselineWinRate: 0.54, baselineAvgReturn: 0.005, edge: 0.0042, pValue: 0.34, sharpe: 1, maxDrawdown: -0.1, bearishSignals: 4, bearishHitRate: 0.5, bearishAvgForwardReturn: 0, lowSample: false },
      { holdDays: 5, windowDays: 250, trades: 22, winRate: 0.6, winRateCI: [0.4, 0.78], avgReturn: 0.02, baselineWinRate: 0.54, baselineAvgReturn: 0.005, edge: 0.015, pValue: 0.004, sharpe: 1, maxDrawdown: -0.1, bearishSignals: 4, bearishHitRate: 0.5, bearishAvgForwardReturn: 0, lowSample: false },
      { holdDays: 10, windowDays: 250, trades: 13, winRate: 0.6, winRateCI: [0.4, 0.78], avgReturn: 0.02, baselineWinRate: 0.54, baselineAvgReturn: 0.005, edge: -0.003, sharpe: 1, maxDrawdown: -0.1, bearishSignals: 4, bearishHitRate: 0.5, bearishAvgForwardReturn: 0, lowSample: true },
    ],
  },
  risk: {
    forecastVolatility: 0.42,
    horizonDays: 10,
    price: 189.23,
    range1: { low: 178.2, high: 201.1 },
    range2: { low: 167.5, high: 213.9 },
    ownPercentile: 72.6,
    beta: 1.85,
    volatility63: 0.38,
  },
  meta: { bars: 370, droppedPartialBar: false, lastBarDate: "2026-11-06" },
};

const PROFILE: FactorProfile = {
  symbol: "NVDA",
  asOf: "2026-11-07T15:00:00.000Z",
  values: { momentum: 0.5, reversal: 0.06, high52: 0.95, volatility: 0.38, beta: 1.85 },
  percentiles: { momentum: 85, reversal: 62, high52: 90, volatility: 88, beta: 92 },
  universeSize: 78,
  inUniverse: true,
};

describe("quant facts", () => {
  it("leads with short-term relative strength and never shows the composite label or the Wilson interval", () => {
    const text = quantBlock({ report: REPORT, profile: PROFILE });
    expect(text).toContain("InvestSeek quant facts (model v4; they describe the stock, none of them is a forecast of returns):");
    expect(text).toContain("- short-term relative strength (the technical score, 0-100, from its own recent momentum, trend, RSI and volume; not a rank against other stocks): 41.2, reads weak");
    expect(text).not.toContain("against other large caps");
    expect(text).toContain("- factor readings (0-100, higher reads stronger): strongest momentum 78 (12.0%), trend 70; weakest value 32 (54.2x), rsi 45 (61.3)");
    expect(text).toContain("- universe evaluation (78 large US stocks");
    expect(text).toContain("model v4 dropped the volatility regime after seeing it");
    expect(text).toContain("- hindsight: the 78 stocks were chosen recently; from 2016-01-01 to 2026-11-06 they returned 19.1% a year against 12.0% for the equal-weight S&P 500 (RSP) and 14.6% for SPY");
    expect(text).not.toMatch(/reading: strong|score 64\/100/);
    expect(text).not.toContain("40.8%");
    expect(text).toContain("- limits: the score mixes technical and fundamental factors");
  });

  it("leaves factors without weight out of the readings", () => {
    const withRegime = { ...REPORT, factors: [...REPORT.factors, { key: "volatility" as const, group: "technical" as const, score: 0, weight: 0, imputed: false, raw: 0.48, rawUnit: "percent" as const }] };
    expect(quantBlock({ report: withRegime, profile: null })).toContain("weakest value 32 (54.2x), rsi 45 (61.3)");
    expect(quantBlock({ report: withRegime, profile: null })).not.toContain("volatility 0");
  });

  it("reports the risk forecast with its measured coverage and the volatility group", () => {
    const [forecast, group] = riskForecastLines(REPORT.risk);
    expect(forecast).toBe(
      "- risk forecast (a range, not a direction): next 10 sessions 178.20-201.10 (plus or minus one standard deviation) and 167.50-213.90 (two) around the last close 189.23; in tests on large US stocks over 2016-2026, 71.8% of 10-session moves stayed inside the first range and 94.5% inside the second; forecast volatility 42.0% a year; current 20-session volatility at the 73rd percentile of its own past year; beta to SPY 1.85 (252 sessions)",
    );
    expect(group).toBe(
      "- 63-session volatility 38.0%, in the highest of five universe volatility groups (boundaries 21.9%, 26.0%, 30.9%, 37.4% on 2026-11-06); in that group, 37.3% of stock-months from 2016 to 2026 saw a fall of 10% or more from a high within 21 sessions",
    );
    expect(riskForecastLines(null)).toEqual(["- risk forecast: not available (too little price history)"]);
  });

  it("keeps statistics measured on the stock universe out of fund, crypto and index facts", () => {
    for (const [asset, plural] of [
      ["fund", "funds"],
      ["crypto", "cryptocurrencies"],
      ["index", "indices"],
    ] as const) {
      const text = quantBlock({ report: REPORT, profile: PROFILE, asset });
      expect(text).toContain("they describe this instrument, none of them is a forecast of returns");
      expect(text).toContain(`- evidence: the score and the risk ranges were tested on large US stocks only; there is no tested evidence for them on ${plural}`);
      expect(text).toContain("- risk forecast (a range, not a direction): next 10 sessions 178.20-201.10");
      expect(text).toContain("- 63-session volatility 38.0%\n");
      expect(text).toContain("- one-year backtest of strong readings");
      expect(text).not.toMatch(/universe evaluation|hindsight|universe volatility groups|stock-months|style factor percentiles/);
    }
    expect(riskForecastLines(REPORT.risk, RISK_CALIBRATION, false)[1]).toBe("- 63-session volatility 38.0%");
    expect(quantBlock({ report: null, profile: PROFILE, asset: "fund" })).toBe("InvestSeek quant facts: not available.");
  });

  it("places volatility in the universe quintiles", () => {
    expect(volatilityQuintile(0.2)).toBe(1);
    expect(volatilityQuintile(0.22)).toBe(2);
    expect(volatilityQuintile(0.31)).toBe(4);
    expect(volatilityQuintile(0.5)).toBe(5);
    expect(RISK_CALIBRATION.bands.horizon).toBe(10);
  });

  it("gives each factor percentile its tested evidence", () => {
    const line = factorLine(PROFILE) ?? "";
    expect(line).toContain("- style factor percentiles among 78 large caps (percentile of the raw value, 0-100; none predicted returns in the pre-registered test, so they are descriptive; evidence at 21 sessions)");
    expect(line).toContain("12-1 momentum 85 (IC +0.015, t 0.62, Holm p 1.00)");
    expect(line).toContain("1-month return 62 (tested as short-term reversal: IC +0.033, t 1.60, Holm p 1.00)");
    expect(line).toContain("63-session volatility 88 (tested as low volatility: IC -0.041");
    expect(factorLine({ ...PROFILE, inUniverse: false, symbol: "PLTR" })).toContain("against 78 large caps (PLTR is not one of them)");
    expect(factorLine(null)).toBeNull();
    expect(FACTOR_RESEARCH.factors.every((factor) => factor.results.every((r) => r.verdict === "not_predictive"))).toBe(true);
  });

  it("calls backtest edges with p >= 0.01 random timing", () => {
    expect(backtestLine(REPORT)).toBe(
      "- one-year backtest of strong readings (technical score >= 58, technical factors only, 10 bps round trip): " +
        "3-session hold 36 trades, edge +0.42% against holding every session (p 0.34, indistinguishable from random timing); " +
        "5-session hold 22 trades, edge +1.50% against holding every session (p 0.004, unlikely from random timing); " +
        "10-session hold 13 trades, edge -0.30% against holding every session (no permutation test, fewer than 20 trades)",
    );
    expect(backtestLine({ ...REPORT, backtest: null })).toBe("- backtest: not available");
  });

  it("reports missing and insufficient data honestly", () => {
    expect(quantBlock({ report: null, profile: null })).toBe("InvestSeek quant facts: not available.");
    expect(quantBlock({ report: null, profile: PROFILE })).toContain("model signal not available.\n- style factor percentiles");
    expect(quantBlock({ report: { ...REPORT, status: "insufficient_data", reason: "Only 40 bars", code: null }, profile: null })).toBe(
      "InvestSeek quant facts: insufficient data (Only 40 bars).",
    );
    expect(hindsightLine()).toContain("RSP");
  });
});
