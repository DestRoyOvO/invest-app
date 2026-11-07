import type { SignalEvaluation } from "./evaluation";
import data from "./signal-evaluation.json";

/** The latest universe evaluation (regenerate with `npm run evaluate`). */
export const SIGNAL_EVALUATION = data as unknown as SignalEvaluation;

/** The holding period the app shows by default. */
export const EVALUATION_DAYS = 10;
