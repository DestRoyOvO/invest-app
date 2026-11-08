// The committed research outputs, typed, for the factor lab page only. Quote-page panels import the one file they show
// directly (RiskPanel: risk-calibration.json, FactorProfilePanel: factor-research.json), so importing this module
// anywhere else would pull every research file into that page's bundle.

import type { FactorResearch, RiskCalibration } from "@/lib/evaluation";
import factorResearchJson from "@/lib/factor-research.json";
import riskCalibrationJson from "@/lib/risk-calibration.json";

export { SIGNAL_EVALUATION, EVALUATION_DAYS } from "@/lib/evaluation-data";

/** Pre-registered factor tests (scripts/research-factors.ts, docs/factor-research.md). */
export const FACTOR_RESEARCH = factorResearchJson as unknown as FactorResearch;

/** Calibration of the risk forecast (lib/risk-forecast.ts), from the same run. */
export const RISK_CALIBRATION = riskCalibrationJson as unknown as RiskCalibration;
