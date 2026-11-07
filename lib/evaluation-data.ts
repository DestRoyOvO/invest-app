import type { SignalEvaluation } from "./evaluation";
import data from "./signal-evaluation.json";

// lib/factor-research.json and lib/risk-calibration.json are typed by FactorResearch and RiskCalibration in
// lib/evaluation.ts. They are not loaded here: this module is part of every quote page's client bundle, and a JSON
// import is bundled even where its export goes unused. Import them where they are shown.

/** The latest universe evaluation of the technical score (regenerate with `npm run evaluate`). */
export const SIGNAL_EVALUATION = data as unknown as SignalEvaluation;

/** The holding period the app shows by default. */
export const EVALUATION_DAYS = 10;
